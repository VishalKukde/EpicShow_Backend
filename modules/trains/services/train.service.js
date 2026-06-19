import Train from "../models/Train.js";
import TrainBooking from "../models/TrainBooking.js";

// Utility to check seat availability
export const checkSeatAvailability = async (trainId, requiredSeats) => {
  const train = await Train.findById(trainId);
  if (!train) {
    throw new Error("Train not found");
  }

  return train.availableSeats >= requiredSeats;
};

// Utility to reserve seats
export const reserveSeats = async (trainId, numberOfSeats) => {
  const train = await Train.findById(trainId);
  if (!train) {
    throw new Error("Train not found");
  }

  if (train.availableSeats < numberOfSeats) {
    throw new Error(
      `Only ${train.availableSeats} seats available, but ${numberOfSeats} required`
    );
  }

  train.availableSeats -= numberOfSeats;
  await train.save();

  return train;
};

// Utility to release seats
export const releaseSeats = async (trainId, numberOfSeats) => {
  const train = await Train.findById(trainId);
  if (!train) {
    throw new Error("Train not found");
  }

  train.availableSeats = Math.min(
    train.availableSeats + numberOfSeats,
    train.totalSeats
  );
  await train.save();

  return train;
};

// Utility to get train occupancy percentage
export const getTrainOccupancy = async (trainId) => {
  const train = await Train.findById(trainId);
  if (!train) {
    throw new Error("Train not found");
  }

  const occupancy = ((train.totalSeats - train.availableSeats) / train.totalSeats) * 100;
  return occupancy.toFixed(2);
};

// Utility to get trains between stations
export const getTrainsBetweenStations = async (
  fromStation,
  toStation,
  filters = {}
) => {
  const query = {
    fromStation: { $regex: fromStation, $options: "i" },
    toStation: { $regex: toStation, $options: "i" },
    isActive: true,
    availableSeats: { $gt: 0 },
  };

  if (filters.minPrice) query.price = { $gte: filters.minPrice };
  if (filters.maxPrice) query.price = { ...query.price, $lte: filters.maxPrice };

  if (filters.trainType) query.trainType = filters.trainType;
  if (filters.minRating) query.rating = { $gte: filters.minRating };

  const trains = await Train.find(query);
  return trains;
};

// Utility to validate passenger details
export const validatePassengerDetails = (passengers, seats) => {
  if (!passengers || !Array.isArray(passengers)) {
    throw new Error("Invalid passenger details");
  }

  if (passengers.length !== seats.length) {
    throw new Error("Number of passengers must match number of seats");
  }

  passengers.forEach((passenger, index) => {
    if (!passenger.name || !passenger.age || !passenger.gender) {
      throw new Error(`Invalid passenger details at index ${index}`);
    }

    if (passenger.age < 1 || passenger.age > 120) {
      throw new Error(`Invalid age for passenger at index ${index}`);
    }
  });

  return true;
};

// Utility to calculate booking price
export const calculateBookingPrice = (pricePerSeat, numberOfSeats) => {
  const subtotal = pricePerSeat * numberOfSeats;
  const gst = subtotal * 0.18; // 18% GST
  const total = subtotal + gst;

  return {
    subtotal,
    gst,
    total,
  };
};

// Utility to get user booking history
export const getUserBookingHistory = async (userId) => {
  const bookings = await TrainBooking.find({ userId })
    .populate(
      "trainId",
      "trainName trainNumber fromStation toStation price departureTime arrivalTime"
    )
    .sort({ bookingDate: -1 });

  return bookings;
};

// Utility to generate booking statistics
export const getBookingStats = async (trainId) => {
  const stats = await TrainBooking.aggregate([
    { $match: { trainId: trainId, status: "confirmed" } },
    {
      $group: {
        _id: "$trainId",
        totalBookings: { $sum: 1 },
        totalRevenue: { $sum: "$totalPrice" },
        totalPassengers: { $sum: { $size: "$seats" } },
        averageBookingValue: { $avg: "$totalPrice" },
      },
    },
  ]);

  return stats[0] || {};
};

// Utility to apply discount
export const applyDiscount = (price, discountPercentage) => {
  const discount = (price * discountPercentage) / 100;
  const finalPrice = price - discount;

  return {
    originalPrice: price,
    discount,
    finalPrice,
  };
};
