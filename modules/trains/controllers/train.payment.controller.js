import crypto from "crypto";
import mongoose from "mongoose";
import { razorpay } from "../../../config/razorpay.js";
import Payment from "../../movies/models/Payment.js";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import Train from "../models/Train.js";
import TrainBooking from "../models/TrainBooking.js";
import TrainSeatCount from "../models/TrainSeatCount.js";
import { generatePNR } from "./train.controller.js";

const TRAIN_TAX_RATE = 0.18;
const TRAIN_DAILY_SEAT_LIMIT = 10;

const getUserId = (req) => req.user?.id || req.user?._id || req.body.userId;

const normalizePassengers = (passengers = []) =>
  passengers.map((passenger) => ({
    name: passenger.name,
    age: Number(passenger.age),
    gender: passenger.gender,
    seatNumber: passenger.seatNumber,
  }));

const calculateTrainFare = (price, seatCount) => {
  const baseAmount = Number(price || 0) * Number(seatCount || 0);
  const taxAmount = Number((baseAmount * TRAIN_TAX_RATE).toFixed(2));
  const finalAmount = Number((baseAmount + taxAmount).toFixed(2));
  return { baseAmount, taxAmount, finalAmount };
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

const normalizeFutureJourneyDate = (value) => {
  const date = startOfUtcDay(value);
  if (!date) return null;
  return date;
};

const isBeforeTomorrow = (date) => date.getTime() < tomorrowStartUtc().getTime();

const getSeatAvailability = async (trainId, journeyDate, session = null) => {
  const counter = await TrainSeatCount.findOne({ trainId, journeyDate }).session(session);
  const confirmedSeats = Number(counter?.confirmedSeats || 0);
  const waitlistCount = Number(counter?.waitlistCount || 0);
  return {
    capacity: Number(counter?.capacity || TRAIN_DAILY_SEAT_LIMIT),
    confirmedSeats,
    waitlistCount,
    availableSeats: Math.max(Number(counter?.capacity || TRAIN_DAILY_SEAT_LIMIT) - confirmedSeats, 0),
  };
};

const allocateTrainSeatsForBooking = async ({ booking, session }) => {
  const seatCount = booking.seats.length;
  const journeyDate = startOfUtcDay(booking.journeyDate);
  let counter = await TrainSeatCount.findOne({ trainId: booking.trainId, journeyDate }).session(session);

  if (!counter) {
    try {
      [counter] = await TrainSeatCount.create(
        [
          {
            trainId: booking.trainId,
            journeyDate,
            capacity: TRAIN_DAILY_SEAT_LIMIT,
            confirmedSeats: 0,
            waitlistCount: 0,
          },
        ],
        { session }
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
      counter = await TrainSeatCount.findOne({ trainId: booking.trainId, journeyDate }).session(session);
    }
  }

  const availableSeats = Math.max(Number(counter.capacity || TRAIN_DAILY_SEAT_LIMIT) - Number(counter.confirmedSeats || 0), 0);
  const confirmedSeatCount = Math.min(availableSeats, seatCount);
  const waitlistSeatCount = seatCount - confirmedSeatCount;
  const waitlistStart = Number(counter.waitlistCount || 0) + 1;
  const waitlistNumbers = waitlistSeatCount > 0
    ? Array.from({ length: waitlistSeatCount }, (_, index) => waitlistStart + index)
    : [];

  counter.confirmedSeats = Number(counter.confirmedSeats || 0) + confirmedSeatCount;
  counter.waitlistCount = Number(counter.waitlistCount || 0) + waitlistSeatCount;
  await counter.save({ session });

  return {
    confirmedSeatCount,
    waitlistNumbers,
    seatStatus:
      waitlistSeatCount === 0
        ? "confirmed"
        : confirmedSeatCount === 0
          ? "waitlisted"
          : "partial_waitlisted",
    availableSeats: Math.max(Number(counter.capacity || TRAIN_DAILY_SEAT_LIMIT) - Number(counter.confirmedSeats || 0), 0),
    waitlistCount: Number(counter.waitlistCount || 0),
  };
};

const getTrainPaymentMeta = (train) => {
  const title = train?.trainName
    ? `${train.trainName}${train.trainNumber ? ` #${train.trainNumber}` : ""}`
    : "Train booking";
  const details = train?.fromStation && train?.toStation
    ? `${train.fromStation} to ${train.toStation}`
    : "Train journey";

  return {
    bookingType: "train",
    showType: "train",
    title,
    details,
  };
};

const markTrainBookingPaymentFailed = async ({
  bookingId,
  orderId = null,
  paymentId = null,
  signature = "failed",
  method = "upi",
  session = null,
}) => {
  if (!bookingId) return null;

  const booking = await TrainBooking.findById(bookingId).session(session);
  if (!booking) return null;

  const failedPaymentId = paymentId || `train_failed_${booking._id}_${Date.now()}`;
  const failedOrderId = orderId || booking.razorpayOrderId || `train_failed_order_${booking._id}`;
  const paymentMethod = method || booking.payment?.method || "upi";
  const train = await Train.findById(booking.trainId)
    .select("trainName trainNumber fromStation toStation")
    .session(session);
  const paymentMeta = getTrainPaymentMeta(train);

  booking.status = "failed";
  booking.payment = {
    transactionId: failedPaymentId,
    amount: booking.totalPrice,
    method: paymentMethod,
    status: "failed",
    orderId: failedOrderId,
    signature,
    currency: booking.payment?.currency || "INR",
  };
  await booking.save({ session });

  await Payment.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        bookingId: booking._id,
        ...paymentMeta,
        orderId: failedOrderId,
        paymentId: failedPaymentId,
        signature,
        method: paymentMethod,
        amount: booking.totalPrice,
        currency: booking.payment.currency || "INR",
        status: "failed",
      },
    },
    { upsert: true, new: true, session }
  );

  return booking;
};

export const prepareTrainPayment = async (req, res) => {
  try {
    const { trainId, seats = [], journeyDate } = req.body;

    if (!trainId || !Array.isArray(seats) || seats.length === 0) {
      return res.status(400).json({ message: "Missing train seats" });
    }

    const selectedJourneyDate = normalizeFutureJourneyDate(journeyDate);
    if (!selectedJourneyDate || isBeforeTomorrow(selectedJourneyDate)) {
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }

    const train = await Train.findById(trainId).select("price");
    if (!train) {
      return res.status(404).json({ message: "Train not found" });
    }

    const fare = calculateTrainFare(train.price, seats.length);
    const availability = await getSeatAvailability(trainId, selectedJourneyDate);

    res.json({
      ...fare,
      taxRate: TRAIN_TAX_RATE,
      verifiedSeats: seats,
      availability,
      seatStatus: availability.availableSeats >= seats.length ? "confirmed" : "waitlisted",
      waitlistStart:
        availability.availableSeats >= seats.length
          ? null
          : availability.waitlistCount + 1,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Train payment validation failed" });
  }
};

export const createTrainOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = getUserId(req);
    const {
      trainId,
      seats = [],
      passengers = [],
      passengerDetails = passengers,
      journeyDate,
      showType= "train",
      paymentMethod = "upi",
    } = req.body;

    if (!userId || !trainId || !Array.isArray(seats) || seats.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Missing train booking details" });
    }

    const normalizedPassengers = normalizePassengers(passengerDetails);
    if (normalizedPassengers.length !== seats.length) {
      await session.abortTransaction();
      return res.status(400).json({
        message: "Passenger details must match selected seats",
      });
    }

    const selectedJourneyDate = normalizeFutureJourneyDate(journeyDate);
    if (!selectedJourneyDate || isBeforeTomorrow(selectedJourneyDate)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Journey date must be from tomorrow onward" });
    }

    const train = await Train.findById(trainId).select("price").session(session);
    if (!train) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Train not found" });
    }

    const fare = calculateTrainFare(train.price, seats.length);
    const amount = fare.finalAmount;

    const [booking] = await TrainBooking.create(
      [
        {
          trainId,
          userId,
          pnr: generatePNR(),
          seats,
          passengerDetails: normalizedPassengers,
          baseAmount: fare.baseAmount,
          taxAmount: fare.taxAmount,
          totalPrice: amount,
          journeyDate: selectedJourneyDate,
          status: "pending",
          seatStatus: "pending",
          showType: showType || "train",
          payment: {
            amount,
            method: paymentMethod,
            status: "pending",
          },
        },
      ],
      { session }
    );

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: booking._id.toString(),
    });

    booking.razorpayOrderId = order.id;
    booking.payment.orderId = order.id;
    await booking.save({ session });

    await session.commitTransaction();

    res.json({
      bookingId: booking._id,
      pnr: booking.pnr,
      razorpayOrderId: order.id,
      amount,
      baseAmount: fare.baseAmount,
      taxAmount: fare.taxAmount,
      taxRate: TRAIN_TAX_RATE,
      currency: "INR",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    res.status(500).json({ message: "Train order creation failed" });
  } finally {
    session.endSession();
  }
};

export const verifyTrainPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSign !== razorpay_signature) {
      await markTrainBookingPaymentFailed({
        bookingId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature || "invalid_signature",
        session,
      });
      await session.commitTransaction();
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const booking = await TrainBooking.findById(bookingId).session(session);
    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "confirmed") {
      await session.commitTransaction();
      return res.json({ success: true, bookingId: booking._id, pnr: booking.pnr });
    }

    const train = await Train.findById(booking.trainId)
      .select("trainName trainNumber fromStation toStation")
      .session(session);
    const seatAllocation = await allocateTrainSeatsForBooking({ booking, session });

    const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
    const paymentMeta = getTrainPaymentMeta(train);

    booking.status = "confirmed";
    booking.seatStatus = seatAllocation.seatStatus;
    booking.confirmedSeatCount = seatAllocation.confirmedSeatCount;
    booking.waitlistNumbers = seatAllocation.waitlistNumbers;
    booking.payment = {
      transactionId: razorpay_payment_id,
      amount: booking.totalPrice,
      method: paymentDetails.method || booking.payment.method || "upi",
      status: "success",
      orderId: razorpay_order_id,
      signature: razorpay_signature,
      currency: paymentDetails.currency || "INR",
    };
    await booking.save({ session });

    await Payment.create(
      [
        {
          bookingId: booking._id,
          ...paymentMeta,
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          signature: razorpay_signature,
          method: paymentDetails.method,
          amount: booking.totalPrice,
          currency: paymentDetails.currency || "INR",
          status: "success",
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.json({
      success: true,
      bookingId: booking._id,
      pnr: booking.pnr,
      seatStatus: booking.seatStatus,
      waitlistNumbers: booking.waitlistNumbers,
    });
  } catch (err) {
    await session.abortTransaction();
    try {
      await markTrainBookingPaymentFailed({
        bookingId: req.body?.bookingId,
        orderId: req.body?.razorpay_order_id,
        paymentId: req.body?.razorpay_payment_id,
        signature: req.body?.razorpay_signature || "verification_error",
      });
    } catch (markErr) {
      console.error("Failed to mark train payment as failed:", markErr);
    }
    console.error(err);
    res.status(500).json({ message: "Train payment verification failed" });
  } finally {
    session.endSession();
  }
};

export const markTrainPaymentFailed = async (req, res) => {
  try {
    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      method,
    } = req.body;

    const booking = await markTrainBookingPaymentFailed({
      bookingId,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature || "failed",
      method,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json({ success: true, bookingId: booking._id, pnr: booking.pnr });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update train payment status" });
  }
};

export const payTrainWithWallet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = getUserId(req);
    const { bookingId } = req.body;

    if (!userId || !bookingId) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Missing booking details" });
    }

    const booking = await TrainBooking.findOne({ _id: bookingId, userId }).session(session);
    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "confirmed") {
      await session.commitTransaction();
      return res.json({ success: true, bookingId: booking._id, pnr: booking.pnr });
    }

    if (booking.status !== "pending") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Booking is not payable" });
    }

    const amount = Number(booking.totalPrice || 0);
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User not found" });
    }

    const balanceBefore = Number(user.walletBalance || 0);
    if (balanceBefore < amount) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const train = await Train.findById(booking.trainId)
      .select("trainName trainNumber fromStation toStation")
      .session(session);
    const seatAllocation = await allocateTrainSeatsForBooking({ booking, session });

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: amount } },
      { $inc: { walletBalance: -amount } },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      return res.status(409).json({ message: "Unable to deduct wallet balance" });
    }

    const balanceAfter = Number(updatedUser.walletBalance || 0);
    const paymentId = `train_wallet_${booking._id}_${Date.now()}`;

    booking.status = "confirmed";
    booking.seatStatus = seatAllocation.seatStatus;
    booking.confirmedSeatCount = seatAllocation.confirmedSeatCount;
    booking.waitlistNumbers = seatAllocation.waitlistNumbers;
    booking.payment = {
      transactionId: paymentId,
      amount,
      method: "wallet",
      status: "success",
      orderId: `wallet_order_${booking._id}`,
      signature: "wallet",
      currency: "INR",
    };
    await booking.save({ session });

    const [payment] = await Payment.create(
      [
        {
          bookingId: booking._id,
          orderId: `wallet_order_${booking._id}`,
          paymentId,
          signature: "wallet",
          method: "wallet",
          amount,
          currency: "INR",
          status: "success",
        },
      ],
      { session }
    );

    if (amount > 0) {
      await WalletTransaction.create(
        [
          {
            user: userId,
            type: "debit",
            source: "booking_payment",
            amount,
            balanceBefore,
            balanceAfter,
            status: "success",
            note: `Train booking payment (${booking._id})`,
            booking: booking._id,
            payment: payment._id,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();

    res.json({
      success: true,
      bookingId: booking._id,
      pnr: booking.pnr,
      seatStatus: booking.seatStatus,
      waitlistNumbers: booking.waitlistNumbers,
      walletBalance: balanceAfter,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    res.status(500).json({ message: "Train wallet payment failed" });
  } finally {
    session.endSession();
  }
};
