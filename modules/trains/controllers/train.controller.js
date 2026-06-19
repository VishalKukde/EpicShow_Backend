import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Train from "../models/Train.js";
import TrainBooking from "../models/TrainBooking.js";
import TrainSeatCount from "../models/TrainSeatCount.js";
import SavedTrainPassenger from "../models/SavedTrainPassenger.js";
import Payment from "../../movies/models/Payment.js";
import { getRedisClient } from "../../../config/redis.js";

const TRAINS_CACHE_PREFIX = "trains";
const TRAINS_CACHE_TTL = 3600; // 1 hour
const TRAIN_TAX_RATE = 0.18;
const TRAIN_DAILY_SEAT_LIMIT = 10;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.join(__dirname, "../data/trains.json");

// Helper to generate PNR
export const generatePNR = () => {
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return `PNR${randomNumber}`;
};

const calculateTrainFare = (price, seatCount) => {
  const baseAmount = Number(price || 0) * Number(seatCount || 0);
  const taxAmount = Number((baseAmount * TRAIN_TAX_RATE).toFixed(2));
  const totalPrice = Number((baseAmount + taxAmount).toFixed(2));
  return { baseAmount, taxAmount, totalPrice };
};

const startOfUtcDay = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const tomorrowStartUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
};

const isBeforeTomorrow = (date) => date.getTime() < tomorrowStartUtc().getTime();

const normalizeFutureJourneyDate = (value) => {
  const date = startOfUtcDay(value);
  if (!date || isBeforeTomorrow(date)) return null;
  return date;
};

const parseTrainDateTime = (dateValue, timeValue) => {
  const date = startOfUtcDay(dateValue);
  if (!date || !timeValue || timeValue === "-") return null;

  const match = String(timeValue).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes
  );
};

const restoreTrainSeatCounter = async (booking) => {
  const journeyDate = startOfUtcDay(booking.journeyDate);
  if (!journeyDate) return;

  const confirmedSeatCount = Math.max(Number(booking.confirmedSeatCount || 0), 0);
  const waitlistCount = Array.isArray(booking.waitlistNumbers) ? booking.waitlistNumbers.length : 0;

  if (!confirmedSeatCount && !waitlistCount) return;

  await TrainSeatCount.findOneAndUpdate(
    { trainId: booking.trainId, journeyDate },
    {
      $inc: {
        confirmedSeats: -confirmedSeatCount,
        waitlistCount: -waitlistCount,
      },
    }
  );
};

const getTrainPaymentMeta = (train) => ({
  bookingType: "train",
  showType: "train",
  title: train?.trainName
    ? `${train.trainName}${train.trainNumber ? ` #${train.trainNumber}` : ""}`
    : "Train booking",
  details: train?.fromStation && train?.toStation
    ? `${train.fromStation} to ${train.toStation}`
    : "Train journey",
});

const withDatedAvailability = async (trains, journeyDate) => {
  if (!journeyDate) {
    return trains.map((train) => ({
      ...train.toObject(),
      totalSeats: TRAIN_DAILY_SEAT_LIMIT,
      availableSeats: TRAIN_DAILY_SEAT_LIMIT,
      waitlistCount: 0,
      availabilityDate: null,
    }));
  }

  const ids = trains.map((train) => train._id);
  const counters = await TrainSeatCount.find({
    trainId: { $in: ids },
    journeyDate,
  });
  const counterByTrain = new Map(counters.map((counter) => [counter.trainId.toString(), counter]));

  return trains.map((train) => {
    const counter = counterByTrain.get(train._id.toString());
    const capacity = Number(counter?.capacity || TRAIN_DAILY_SEAT_LIMIT);
    const confirmedSeats = Number(counter?.confirmedSeats || 0);
    const waitlistCount = Number(counter?.waitlistCount || 0);

    return {
      ...train.toObject(),
      totalSeats: capacity,
      availableSeats: Math.max(capacity - confirmedSeats, 0),
      confirmedSeats,
      waitlistCount,
      availabilityDate: journeyDate.toISOString().slice(0, 10),
    };
  });
};

const allocateTrainSeatsForBooking = async (booking) => {
  const journeyDate = startOfUtcDay(booking.journeyDate);
  let counter = await TrainSeatCount.findOne({ trainId: booking.trainId, journeyDate });

  if (!counter) {
    counter = await TrainSeatCount.create({
      trainId: booking.trainId,
      journeyDate,
      capacity: TRAIN_DAILY_SEAT_LIMIT,
      confirmedSeats: 0,
      waitlistCount: 0,
    });
  }

  const seatCount = booking.seats.length;
  const availableSeats = Math.max(Number(counter.capacity || TRAIN_DAILY_SEAT_LIMIT) - Number(counter.confirmedSeats || 0), 0);
  const confirmedSeatCount = Math.min(availableSeats, seatCount);
  const waitlistSeatCount = seatCount - confirmedSeatCount;
  const waitlistStart = Number(counter.waitlistCount || 0) + 1;
  const waitlistNumbers = waitlistSeatCount > 0
    ? Array.from({ length: waitlistSeatCount }, (_, index) => waitlistStart + index)
    : [];

  counter.confirmedSeats = Number(counter.confirmedSeats || 0) + confirmedSeatCount;
  counter.waitlistCount = Number(counter.waitlistCount || 0) + waitlistSeatCount;
  await counter.save();

  return {
    confirmedSeatCount,
    waitlistNumbers,
    seatStatus:
      waitlistSeatCount === 0
        ? "confirmed"
        : confirmedSeatCount === 0
          ? "waitlisted"
          : "partial_waitlisted",
  };
};

const normalizePassengerName = (value) =>
  String(value || "").trim().replace(/\s+/g, " ");

const toSavedPassengerResponse = (passenger) => ({
  _id: passenger._id,
  name: passenger.name,
  age: passenger.age,
  gender: passenger.gender,
});

const loadSeedTrains = async () => {
  try {
    const raw = await fs.readFile(seedPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeImageUrl = (value) => {
  if (typeof value !== "string") return "/assets/category/Train.png";
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/^\/public\//, "/") : "/assets/category/Train.png";
};

const normalizeTrain = (item) => ({
  ...item,
  trainNumber: String(item.trainNumber || "").trim().toUpperCase(),
  trainName: String(item.trainName || "").trim(),
  fromStation: String(item.fromStation || "").trim(),
  toStation: String(item.toStation || "").trim(),
  imageUrl: normalizeImageUrl(item.imageUrl),
  totalSeats: Number(item.totalSeats || 0),
  availableSeats: Number(item.availableSeats ?? item.totalSeats ?? 0),
  price: Number(item.price || 0),
  rating: Number(item.rating || 4),
  amenities: Array.isArray(item.amenities) ? item.amenities : [],
  operatingDays: Array.isArray(item.operatingDays) && item.operatingDays.length
    ? item.operatingDays
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  isActive: item.isActive !== false,
});

const seedTrainsIfEmpty = async () => {
  const count = await Train.countDocuments();
  if (count > 0) return;

  const seed = await loadSeedTrains();
  if (!seed.length) return;

  await Train.insertMany(seed.map(normalizeTrain), { ordered: true });
};

// Get all trains
export const getAllTrains = async (req, res) => {
  try {
    await seedTrainsIfEmpty();
    const journeyDate = req.query.date ? normalizeFutureJourneyDate(req.query.date) : null;
    if (req.query.date && !journeyDate) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }
    const trains = await Train.find({ isActive: true });
    res.json(await withDatedAvailability(trains, journeyDate));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get train by ID
export const getTrainById = async (req, res) => {
  try {
    const journeyDate = req.query.date ? normalizeFutureJourneyDate(req.query.date) : null;
    if (req.query.date && !journeyDate) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }
    const train = await Train.findById(req.params.id);
    if (!train) {
      return res.status(404).json({ message: "Train not found" });
    }
    const [withAvailability] = await withDatedAvailability([train], journeyDate);
    res.json(withAvailability);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Search trains
export const searchTrains = async (req, res) => {
  try {
    await seedTrainsIfEmpty();
    const { fromStation, toStation, date, trainType } = req.query;
    const journeyDate = date ? normalizeFutureJourneyDate(date) : null;
    if (date && !journeyDate) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }

    const query = { isActive: true };

    if (fromStation) {
      query.fromStation = { $regex: fromStation, $options: "i" };
    }

    if (toStation) {
      query.toStation = { $regex: toStation, $options: "i" };
    }

    if (trainType) {
      query.trainType = trainType;
    }

    const trains = await Train.find(query).sort({ price: 1 });

    res.json(await withDatedAvailability(trains, journeyDate));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get available trains between two stations
export const getAvailableTrains = async (req, res) => {
  try {
    await seedTrainsIfEmpty();
    const { fromStation, toStation, date } = req.query;
    const journeyDate = date ? normalizeFutureJourneyDate(date) : null;
    if (date && !journeyDate) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }

    if (!fromStation || !toStation) {
      return res.status(400).json({
        message: "fromStation and toStation are required",
      });
    }

    const trains = await Train.find({
      fromStation: { $regex: fromStation, $options: "i" },
      toStation: { $regex: toStation, $options: "i" },
      isActive: true,
    }).sort({ departureTime: 1 });

    res.json(await withDatedAvailability(trains, journeyDate));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getSavedPassengers = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const passengers = await SavedTrainPassenger.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(20);

    res.json({ passengers: passengers.map(toSavedPassengerResponse) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const savePassenger = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const name = normalizePassengerName(req.body?.name);
    const age = Number(req.body?.age);
    const gender = req.body?.gender;

    if (!name || !Number.isFinite(age) || age < 1 || age > 120 || !["M", "F", "Other"].includes(gender)) {
      return res.status(400).json({ message: "Valid passenger name, age, and gender are required" });
    }

    const passenger = await SavedTrainPassenger.findOneAndUpdate(
      {
        userId,
        normalizedName: name.toLowerCase(),
        age,
        gender,
      },
      {
        $set: {
          userId,
          name,
          normalizedName: name.toLowerCase(),
          age,
          gender,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ passenger: toSavedPassengerResponse(passenger) });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Passenger already saved" });
    }
    res.status(500).json({ message: err.message });
  }
};

// Book train
export const bookTrain = async (req, res) => {
  try {
    const {
      trainId,
      seats,
      passengerDetails,
      paymentMethod,
      transactionId,
      journeyDate,
    } = req.body;

    // Validate request
    if (!trainId || !seats || !passengerDetails) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (seats.length !== passengerDetails.length) {
      return res.status(400).json({
        message: "Number of seats must match number of passengers",
      });
    }

    // Check if train exists
    const train = await Train.findById(trainId);
    if (!train) {
      return res.status(404).json({ message: "Train not found" });
    }

    const selectedJourneyDate = normalizeFutureJourneyDate(journeyDate);
    if (!selectedJourneyDate) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }

    const fare = calculateTrainFare(train.price, seats.length);

    // Generate PNR
    const pnr = generatePNR();

    // Create booking
    const booking = new TrainBooking({
      trainId,
      userId: req.user?.id || "guest", // Assuming auth middleware sets req.user
      pnr,
      seats,
      passengerDetails,
      baseAmount: fare.baseAmount,
      taxAmount: fare.taxAmount,
      totalPrice: fare.totalPrice,
      journeyDate: selectedJourneyDate,
      payment: {
        transactionId,
        amount: fare.totalPrice,
        method: paymentMethod,
        status: "success",
      },
    });

    await booking.save();
    const seatAllocation = await allocateTrainSeatsForBooking(booking);
    booking.status = "confirmed";
    booking.seatStatus = seatAllocation.seatStatus;
    booking.confirmedSeatCount = seatAllocation.confirmedSeatCount;
    booking.waitlistNumbers = seatAllocation.waitlistNumbers;
    await booking.save();

    // Invalidate cache
    try {
      const redis = await getRedisClient();
      await redis.del(`${TRAINS_CACHE_PREFIX}:*`);
    } catch (err) {
      console.error("Cache invalidation failed:", err);
    }

    res.status(201).json({
      message: "Booking confirmed",
      booking: {
        pnr: booking.pnr,
        bookingId: booking._id,
        totalPrice: booking.totalPrice,
        status: booking.status,
        seatStatus: booking.seatStatus,
        waitlistNumbers: booking.waitlistNumbers,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get user bookings
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const bookings = await TrainBooking.find({ userId })
      .populate("trainId", "trainName trainNumber fromStation toStation price")
      .sort({ bookingDate: -1 });

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getProfileTrainBookings = async (req, res) => {
  try {
    const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "0"), 10);
    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 0 : Math.min(parsedLimit, 50);
    const usePagination = limit > 0;
    const skip = usePagination ? (page - 1) * limit : 0;

    const query = { userId: req.user.id };
    const totalCount = await TrainBooking.countDocuments(query);
    const rows = await TrainBooking.find(query)
      .populate("trainId", "trainName trainNumber fromStation toStation imageUrl departureTime arrivalTime")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(usePagination ? limit : 0);

    const data = rows.map((booking) => {
      const train = booking.trainId || {};
      const journeyDate = booking.journeyDate
        ? new Date(booking.journeyDate).toISOString().slice(0, 10)
        : "";

      return {
        _id: booking._id,
        userId: booking.userId,
        itemId: train._id?.toString?.() || booking.trainId?.toString?.() || "",
        cinemaId: `${train.fromStation || "From"} to ${train.toStation || "To"}`,
        date: journeyDate,
        slot: train.departureTime || "-",
        seatIds: booking.seats,
        amount: booking.totalPrice,
        status: booking.status === "confirmed" ? "paid" : booking.status,
        showType: "train",
        showTime: booking.journeyDate,
        createdAt: booking.createdAt,
        paymentId: booking.payment?.transactionId || null,
        pnr: booking.pnr,
        seatStatus: booking.seatStatus,
        confirmedSeatCount: booking.confirmedSeatCount,
        waitlistNumbers: booking.waitlistNumbers,
        payment: booking.payment,
        show: {
          name: train.trainName
            ? `${train.trainName} #${train.trainNumber || ""}`.trim()
            : "Train booking",
          imageUrl: train.imageUrl || "/assets/category/Train.png",
        },
      };
    });

    res.status(200).json({
      success: true,
      count: data.length,
      totalCount,
      data,
      pagination: {
        page,
        limit: usePagination ? limit : totalCount,
        total: totalCount,
        hasMore: usePagination ? skip + data.length < totalCount : false,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch train bookings" });
  }
};

// Get booking by PNR
export const getBookingByPNR = async (req, res) => {
  try {
    const { pnr } = req.params;

    const booking = await TrainBooking.findOne({ pnr }).populate(
      "trainId",
      "trainName trainNumber fromStation toStation departureTime arrivalTime"
    );

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getTrainBooking = async (req, res) => {
  try {
    const booking = await TrainBooking.findOne({
      _id: req.params.id,
      userId: req.user.id,
    }).populate(
      "trainId",
      "trainName trainNumber fromStation toStation imageUrl departureTime arrivalTime"
    );

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const train = booking.trainId || {};
    const paymentRecord = await Payment.findOne({ bookingId: booking._id }).sort({ updatedAt: -1 });
    const payment = paymentRecord
      ? {
          paymentId: paymentRecord.paymentId,
          bookingId: booking._id,
          method: paymentRecord.method || booking.payment?.method,
          amount: paymentRecord.amount || booking.payment?.amount || booking.totalPrice,
          currency: paymentRecord.currency || booking.payment?.currency || "INR",
          status: paymentRecord.status,
          createdAt: paymentRecord.updatedAt || paymentRecord.createdAt,
        }
      : booking.payment?.transactionId
      ? {
          paymentId: booking.payment.transactionId,
          bookingId: booking._id,
          method: booking.payment.method,
          amount: booking.payment.amount,
          currency: booking.payment.currency || "INR",
          status: booking.status === "cancelled"
            ? "refund_initiated"
            : booking.payment.status === "success" ? "success" : "failed",
          createdAt: booking.updatedAt || booking.createdAt,
        }
      : null;

    return res.json({
      booking: {
        _id: booking._id,
        userId: booking.userId,
        itemId: train._id?.toString?.() || booking.trainId?.toString?.() || "",
        trainName: train.trainName || "",
        trainNumber: train.trainNumber || "",
        cinemaId: `${train.fromStation || "From"} to ${train.toStation || "To"}`,
        date: booking.journeyDate
          ? new Date(booking.journeyDate).toISOString().slice(0, 10)
          : "",
        slot: train.departureTime || "-",
        arrivalTime: train.arrivalTime || "-",
        seatIds: booking.seats,
        amount: booking.totalPrice,
        status: booking.status === "confirmed" ? "paid" : booking.status,
        showType: "train",
        showTime: booking.journeyDate,
        createdAt: booking.createdAt,
        paymentId: booking.payment?.transactionId || null,
        pnr: booking.pnr,
        seatStatus: booking.seatStatus,
        confirmedSeatCount: booking.confirmedSeatCount,
        waitlistNumbers: booking.waitlistNumbers,
      },
      payment,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to fetch train booking" });
  }
};

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const bookingQuery = { _id: bookingId };
    if (req.user?.role !== "admin") {
      bookingQuery.userId = req.user.id;
    }

    const booking = await TrainBooking.findOne(bookingQuery);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "cancelled") {
      return res.status(400).json({ message: "Booking already cancelled" });
    }

    if (!["confirmed", "pending"].includes(booking.status)) {
      return res.status(400).json({ message: "Booking cannot be cancelled" });
    }

    const train = await Train.findById(booking.trainId).select("trainName trainNumber fromStation toStation departureTime");
    const departureAt = parseTrainDateTime(booking.journeyDate, train?.departureTime);
    if (departureAt && departureAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Cannot cancel expired train booking" });
    }

    const refundAmount = Number((Number(booking.totalPrice || 0) * 0.75).toFixed(2));

    booking.status = "cancelled";
    booking.cancellationDetails = {
      cancelledAt: new Date(),
      refundAmount,
      refundStatus: "pending",
    };

    await booking.save();
    await restoreTrainSeatCounter(booking);

    if (booking.payment?.transactionId) {
      await Payment.findOneAndUpdate(
        { bookingId: booking._id },
        {
          $set: {
            ...getTrainPaymentMeta(train),
            bookingId: booking._id,
            orderId: booking.payment.orderId || booking.razorpayOrderId || `train_order_${booking._id}`,
            paymentId: booking.payment.transactionId,
            signature: booking.payment.signature || "train",
            method: booking.payment.method || "upi",
            amount: booking.payment.amount || booking.totalPrice,
            currency: booking.payment.currency || "INR",
            status: "refund_initiated",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.json({
      message: "Booking cancelled successfully",
      refundAmount,
      booking,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create train (admin only)
export const createTrain = async (req, res) => {
  try {
    const train = new Train(req.body);
    await train.save();

    // Invalidate cache
    try {
      const redis = await getRedisClient();
      await redis.del(`${TRAINS_CACHE_PREFIX}:*`);
    } catch (err) {
      console.error("Cache invalidation failed:", err);
    }

    res.status(201).json(train);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Update train (admin only)
export const updateTrain = async (req, res) => {
  try {
    const train = await Train.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!train) {
      return res.status(404).json({ message: "Train not found" });
    }

    // Invalidate cache
    try {
      const redis = await getRedisClient();
      await redis.del(`${TRAINS_CACHE_PREFIX}:*`);
    } catch (err) {
      console.error("Cache invalidation failed:", err);
    }

    res.json(train);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Delete train (admin only)
export const deleteTrain = async (req, res) => {
  try {
    const train = await Train.findByIdAndDelete(req.params.id);

    if (!train) {
      return res.status(404).json({ message: "Train not found" });
    }

    // Invalidate cache
    try {
      const redis = await getRedisClient();
      await redis.del(`${TRAINS_CACHE_PREFIX}:*`);
    } catch (err) {
      console.error("Cache invalidation failed:", err);
    }

    res.json({ message: "Train deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get train statistics (admin only)
export const getTrainStats = async (req, res) => {
  try {
    const totalTrains = await Train.countDocuments({ isActive: true });
    const totalBookings = await TrainBooking.countDocuments({
      status: "confirmed",
    });
    const totalRevenue = await TrainBooking.aggregate([
      { $match: { status: "confirmed" } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    res.json({
      totalTrains,
      totalBookings,
      totalRevenue: totalRevenue[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
