import crypto from "crypto";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Seat from "../models/Seat.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import User from "../../user/model/User.js";
import RewardTransaction from "../../wallet/model/RewardTransaction.js";
import ExportLog from "../models/ExportLog.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";
import {
  createBookedSeatsForBooking,
  ensureSeatsNotBooked,
  finalizeSeatLocksAfterBooking,
  resolveBookingShowId,
  withPaymentIdempotency,
} from "../services/booking-finalization.service.js";
import { assertSeatLocksOwnedByUser } from "../services/seat-lock.service.js";
import { buildShowId, normalizeString, toIdString } from "../utils/show.utils.js";

const MIN_REWARD_POINTS_TO_ELIGIBLE = 150;
const REWARD_REDEEM_POINTS = 100;
const REWARD_REDEEM_DISCOUNT = 100;
const REWARD_EARN_RATE = 0.1;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sportsDataPath = path.join(__dirname, "../../sports/data/sports.json");
let sportsCache = null;

const loadSportsData = async () => {
  if (sportsCache) return sportsCache;
  try {
    const raw = await fs.readFile(sportsDataPath, "utf-8");
    const parsed = JSON.parse(raw);
    sportsCache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to load sports data:", err);
    sportsCache = [];
  }
  return sportsCache;
};

const buildSportTitle = (match, fallback) => {
  if (match?.teamA && match?.teamB) {
    return `${match.teamA} vs ${match.teamB}`;
  }
  if (fallback?.teams?.teamA && fallback?.teams?.teamB) {
    return `${fallback.teams.teamA} vs ${fallback.teams.teamB}`;
  }
  if (match?.league) {
    return `${match.league}${match.matchNo ? ` • ${match.matchNo}` : ""}`;
  }
  return fallback?.title || "Sport booking";
};

const buildSportDetails = (match, fallback) => {
  const parts = [];
  const league = match?.league || fallback?.league;
  const matchNo = match?.matchNo || fallback?.matchNo;
  const venue = match?.venue || fallback?.venue?.name;
  const city = match?.city || fallback?.venue?.city;

  if (league) parts.push(league);
  if (matchNo) parts.push(matchNo);

  const venueLabel = [venue, city].filter(Boolean).join(", ");
  if (venueLabel) parts.push(venueLabel);

  return parts.join(" • ");
};

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeSeatIds = (seatIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(seatIds) ? seatIds : [])
        .map((seatId) => normalizeString(seatId))
        .filter(Boolean)
    )
  );

const resolveMovieShowContext = ({ movieId, cinemaId, showDate, showSlot }) => {
  const normalizedMovieId = toIdString(movieId);
  const normalizedCinemaId = normalizeString(cinemaId);
  const normalizedShowDate = normalizeString(showDate);
  const normalizedShowSlot = normalizeString(showSlot);

  return {
    movieId: normalizedMovieId,
    cinemaId: normalizedCinemaId,
    showDate: normalizedShowDate,
    showSlot: normalizedShowSlot,
    showId: buildShowId({
      itemId: normalizedMovieId,
      cinemaId: normalizedCinemaId,
      showDate: normalizedShowDate,
      showSlot: normalizedShowSlot,
    }),
  };
};

const calculateMovieSeatTotal = (cinema, seatIds = []) => {
  const selectedSeatIds = new Set(seatIds);

  return cinema.seats.reduce((grandTotal, row) => {
    const rowTotal = row.seats.reduce((total, seat) => {
      if (!selectedSeatIds.has(seat.seatId)) {
        return total;
      }

      return total + Number(seat.price || 0);
    }, 0);

    return grandTotal + rowTotal;
  }, 0);
};

const assertMovieSeatsReadyForPayment = async ({ showId, seatIds, userId, session = null }) => {
  const [availability, lockState] = await Promise.all([
    ensureSeatsNotBooked({
      showId,
      seatIds,
      session,
    }),
    assertMovieSeatLocksAreStillValid({
      showId,
      seatIds,
      userId,
    }),
  ]);

  if (!availability.available || !lockState.valid) {
    throw createHttpError("Seat no longer available", 409);
  }
};

const buildLockValidationPayload = ({ showId, seatIds, userId }) => ({
  showId,
  seatIds,
  userId,
});

const assertMovieSeatLocksAreStillValid = async ({ showId, seatIds, userId }) => {
  return assertSeatLocksOwnedByUser(buildLockValidationPayload({ showId, seatIds, userId }));
};

export const preparePayment = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id || req.body.userId || req.body.user);
    const {
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatIds,
      coupon,
      redeemReward = false,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    const normalizedSeatIds = normalizeSeatIds(seatIds);
    const showContext = resolveMovieShowContext({
      movieId,
      cinemaId,
      showDate,
      showSlot,
    });

    if (!showContext.showId || normalizedSeatIds.length === 0) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    const cinema = await Seat.findOne({ cinemaId: showContext.cinemaId });

    if (!cinema) {
      return res.status(404).json({ message: "Cinema not found" });
    }

    await assertMovieSeatsReadyForPayment({
      showId: showContext.showId,
      seatIds: normalizedSeatIds,
      userId,
    });

    let total = calculateMovieSeatTotal(cinema, normalizedSeatIds);

    if (coupon && redeemReward) {
      return res
        .status(400)
        .json({ message: "Coupon and reward redemption cannot be applied together" });
    }

    if (coupon && typeof coupon.off === "number") {
      total -= coupon.off;
    }

    let rewardDiscount = 0;
    let rewardPointsToRedeem = 0;

    if (redeemReward) {
      const user = await User.findById(userId).select("rewardPoints");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.rewardPoints < MIN_REWARD_POINTS_TO_ELIGIBLE) {
        return res
          .status(400)
          .json({ message: "At least 150 reward points are required to redeem" });
      }

      if (user.rewardPoints < REWARD_REDEEM_POINTS) {
        return res.status(400).json({ message: "Insufficient reward points" });
      }

      rewardDiscount = REWARD_REDEEM_DISCOUNT;
      rewardPointsToRedeem = REWARD_REDEEM_POINTS;
      total -= rewardDiscount;
    }

    if (total < 0) {
      total = 0;
    }

    res.json({
      finalAmount: total,
      verifiedSeats: normalizedSeatIds,
      rewardDiscount,
      rewardPointsToRedeem,
      showId: showContext.showId,
    });

  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Payment validation failed",
    });
  }
};


export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const userId = toIdString(req.user?.id || req.body.userId || req.body.user);
    const {
      cinemaId,
      movieId,
      showDate,
      showSlot,
      seatIds,
      coupon,
      showType,
      redeemReward = false,
    } = req.body;

    const normalizedSeatIds = normalizeSeatIds(seatIds);
    const showContext = resolveMovieShowContext({
      movieId,
      cinemaId,
      showDate,
      showSlot,
    });

    if (!showContext.showId || normalizedSeatIds.length === 0 || !userId) {
      throw createHttpError("Missing required fields", 400);
    }

    if (coupon && redeemReward) {
      throw createHttpError(
        "Coupon and reward redemption cannot be applied together",
        400
      );
    }

    await assertMovieSeatsReadyForPayment({
      showId: showContext.showId,
      seatIds: normalizedSeatIds,
      userId,
      session,
    });

    const cinema = await Seat.findOne({ cinemaId: showContext.cinemaId }).session(session);

    if (!cinema) {
      throw createHttpError("Cinema not found", 404);
    }

    let total = calculateMovieSeatTotal(cinema, normalizedSeatIds);

    if (coupon && typeof coupon.off === "number") {
      total -= coupon.off;
    }

    let rewardDiscount = 0;
    let rewardPointsToRedeem = 0;

    if (redeemReward) {
      const rewardUser = await User.findById(userId)
        .select("rewardPoints")
        .session(session);

      if (!rewardUser) {
        throw createHttpError("User not found", 404);
      }

      if (rewardUser.rewardPoints < MIN_REWARD_POINTS_TO_ELIGIBLE) {
        throw createHttpError(
          "At least 150 reward points are required to redeem",
          400
        );
      }

      rewardPointsToRedeem = REWARD_REDEEM_POINTS;
      rewardDiscount = REWARD_REDEEM_DISCOUNT;
      total -= rewardDiscount;

      if (total < 0) {
        total = 0;
      }

      if (rewardUser.rewardPoints < rewardPointsToRedeem) {
        throw createHttpError("Insufficient reward points", 400);
      }
    }

    if (total < 0) {
      total = 0;
    }

    const [createdBooking] = await Booking.create(
      [
        {
          userId,
          itemId: showContext.movieId,
          cinemaId: showContext.cinemaId,
          date: showContext.showDate,
          slot: showContext.showSlot,
          showId: showContext.showId,
          seatIds: normalizedSeatIds,
          amount: total,
          coupon: coupon ? coupon.code : null,
          showType: showType || "movie",
          rewardPointsRedeemed: rewardPointsToRedeem,
          rewardDiscount,
        },
      ],
      { session }
    );

    const order = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: createdBooking._id.toString(),
    });

    await Booking.findByIdAndUpdate(
      createdBooking._id,
      { $set: { razorpayOrderId: order.id } },
      { session }
    );

    await session.commitTransaction();

    res.json({
      bookingId: createdBooking._id,
      razorpayOrderId: order.id,
      amount: total,
      currency: "INR",
      rewardDiscount,
      rewardPointsRedeemed: rewardPointsToRedeem,
      showId: showContext.showId,
    });

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Order creation failed",
    });
  } finally {
    session.endSession();
  }
};


export const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
    } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(sign)
      .digest("hex");

    if (expectedSign !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const result = await withPaymentIdempotency({
      idempotencyKey: `movie:razorpay:${razorpay_payment_id}`,
      onConflict: async () => {
        const existingBooking = await Booking.findById(bookingId)
          .select("_id status paymentId")
          .lean();

        if (existingBooking?.status === "paid") {
          return {
            success: true,
            alreadyPaid: true,
            bookingId: String(existingBooking._id),
            paymentId: existingBooking.paymentId || razorpay_payment_id,
            earnedPoints: 0,
          };
        }

        throw createHttpError("Payment is already being processed", 409);
      },
      handler: async () => {
        const session = await mongoose.startSession();

        try {
          session.startTransaction();

          const booking = await Booking.findById(bookingId).session(session);

          if (!booking) {
            throw createHttpError("Booking not found", 404);
          }

          if (booking.status === "paid") {
            await session.abortTransaction();
            return {
              success: true,
              alreadyPaid: true,
              bookingId: String(booking._id),
              paymentId: booking.paymentId || razorpay_payment_id,
              earnedPoints: 0,
            };
          }

          if (booking.status !== "pending") {
            throw createHttpError("Booking is not payable", 400);
          }

          const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
          const showId = booking.showId || resolveBookingShowId(booking);
          const seatIds = normalizeSeatIds(booking.seatIds);
          const { valid } = await assertMovieSeatLocksAreStillValid({
            showId,
            seatIds,
            userId: booking.userId,
          });

          if (!valid) {
            throw createHttpError("Seat no longer available", 409);
          }

          const { available } = await ensureSeatsNotBooked({
            showId,
            seatIds,
            session,
          });

          if (!available) {
            throw createHttpError("Seat no longer available", 409);
          }

          booking.status = "paid";
          booking.paymentId = razorpay_payment_id;
          booking.showId = showId;
          booking.seatIds = seatIds;
          await booking.save({ session });

          await createBookedSeatsForBooking({
            booking,
            paymentId: razorpay_payment_id,
            showType: booking.showType || "movie",
            session,
          });

          const payment = new Payment({
            bookingId: booking._id,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            method: paymentDetails.method,
            amount: booking.amount,
            currency: paymentDetails.currency,
            status: "success",
          });

          await payment.save({ session });

          if (booking.rewardPointsRedeemed > 0) {
            const rewardUser = await User.findOneAndUpdate(
              {
                _id: booking.userId,
                rewardPoints: { $gte: booking.rewardPointsRedeemed },
              },
              { $inc: { rewardPoints: -booking.rewardPointsRedeemed } },
              { new: true, session }
            );

            if (!rewardUser) {
              throw createHttpError("Insufficient reward points at time of deduction", 409);
            }

            await RewardTransaction.create(
              [
                {
                  user: booking.userId,
                  type: "redeem",
                  points: booking.rewardPointsRedeemed,
                  balanceBefore: Number(
                    (rewardUser.rewardPoints + booking.rewardPointsRedeemed).toFixed(2)
                  ),
                  balanceAfter: Number(rewardUser.rewardPoints.toFixed(2)),
                  bookingId: booking._id,
                },
              ],
              { session }
            );
          }

          const canEarnReward =
            Number(booking.rewardPointsRedeemed || 0) === 0 &&
            Number(booking.amount || 0) >= 450;
          const earnedPoints = canEarnReward
            ? Number((Number(booking.amount || 0) * REWARD_EARN_RATE).toFixed(2))
            : 0;

          if (earnedPoints > 0) {
            const rewardUser = await User.findByIdAndUpdate(
              booking.userId,
              { $inc: { rewardPoints: earnedPoints } },
              { new: true, session }
            );

            if (!rewardUser) {
              throw createHttpError("User not found for reward credit", 404);
            }

            await RewardTransaction.create(
              [
                {
                  user: booking.userId,
                  type: "earn",
                  points: earnedPoints,
                  balanceBefore: Number(
                    (rewardUser.rewardPoints - earnedPoints).toFixed(2)
                  ),
                  balanceAfter: Number(rewardUser.rewardPoints.toFixed(2)),
                  bookingId: booking._id,
                },
              ],
              { session }
            );
          }

          await session.commitTransaction();

          try {
            await finalizeSeatLocksAfterBooking({
              showId,
              seatIds,
              bookingId: booking._id,
              userId: booking.userId,
            });
          } catch (realtimeError) {
            console.error("Post-booking seat cleanup failed:", realtimeError);
          }

          return {
            success: true,
            bookingId: String(booking._id),
            paymentId: razorpay_payment_id,
            earnedPoints,
            showId,
          };
        } catch (error) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }

          throw error;
        } finally {
          session.endSession();
        }
      },
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Payment verification failed",
    });
  }
};


// POST /payment/fail
export const markPaymentFailed = async (req, res) => {
  try {
    const { bookingId } = req.body;

    await Booking.findByIdAndUpdate(bookingId, {
      status: "failed",
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ message: "Failed to update payment status" });
  }
};

// POST /payment/wallet-pay
export const payWithWallet = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id);
    const { bookingId } = req.body;

    if (!userId || !bookingId) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    const result = await withPaymentIdempotency({
      idempotencyKey: `movie:wallet:${bookingId}`,
      onConflict: async () => {
        const existingBooking = await Booking.findOne({
          _id: bookingId,
          userId,
        })
          .select("_id status paymentId")
          .lean();

        if (existingBooking?.status === "paid") {
          return {
            success: true,
            bookingId: String(existingBooking._id),
            alreadyPaid: true,
            paymentId: existingBooking.paymentId || null,
            earnedPoints: 0,
          };
        }

        throw createHttpError("Payment is already being processed", 409);
      },
      handler: async () => {
        const session = await mongoose.startSession();

        try {
          session.startTransaction();

          const booking = await Booking.findOne({
            _id: bookingId,
            userId,
          }).session(session);

          if (!booking) {
            throw createHttpError("Booking not found", 404);
          }

          if (booking.status === "paid") {
            const existingPayment = await Payment.findOne({
              bookingId: booking._id,
            }).session(session);

            await session.abortTransaction();
            return {
              success: true,
              bookingId: String(booking._id),
              alreadyPaid: true,
              paymentId: existingPayment?.paymentId || booking.paymentId || null,
              earnedPoints: 0,
            };
          }

          if (booking.status !== "pending") {
            throw createHttpError("Booking is not payable", 400);
          }

          const amount = Number((booking.amount ?? 0).toFixed(2));
          const showId = booking.showId || resolveBookingShowId(booking);
          const seatIds = normalizeSeatIds(booking.seatIds);
          const { valid } = await assertMovieSeatLocksAreStillValid({
            showId,
            seatIds,
            userId: booking.userId,
          });

          if (!valid) {
            throw createHttpError("Seat no longer available", 409);
          }

          const { available } = await ensureSeatsNotBooked({
            showId,
            seatIds,
            session,
          });

          if (!available) {
            throw createHttpError("Seat no longer available", 409);
          }

          const user = await User.findById(userId).session(session);
          if (!user) {
            throw createHttpError("User not found", 404);
          }

          const balanceBefore = Number((user.walletBalance ?? 0).toFixed(2));
          if (amount > balanceBefore) {
            throw createHttpError("Insufficient wallet balance", 400);
          }

          const balanceAfter = Number((balanceBefore - amount).toFixed(2));

          if (amount > 0) {
            const updatedUser = await User.findOneAndUpdate(
              { _id: userId, walletBalance: { $gte: amount } },
              { $inc: { walletBalance: -amount } },
              { new: true, session }
            );

            if (!updatedUser) {
              throw createHttpError("Unable to deduct wallet balance", 409);
            }
          }

          const paymentId = `${booking._id}_${Date.now()}`;
          booking.status = "paid";
          booking.paymentId = paymentId;
          booking.showId = showId;
          booking.seatIds = seatIds;
          await booking.save({ session });

          await createBookedSeatsForBooking({
            booking,
            paymentId,
            showType: booking.showType || "movie",
            session,
          });

          const payment = new Payment({
            bookingId: booking._id,
            orderId: `wallet_order_${booking._id}`,
            paymentId,
            signature: "wallet",
            method: "wallet",
            amount,
            currency: "INR",
            status: "success",
          });

          await payment.save({ session });

          if (booking.rewardPointsRedeemed > 0) {
            const rewardUser = await User.findOneAndUpdate(
              {
                _id: userId,
                rewardPoints: { $gte: booking.rewardPointsRedeemed },
              },
              { $inc: { rewardPoints: -booking.rewardPointsRedeemed } },
              { new: true, session }
            );

            if (!rewardUser) {
              throw createHttpError("Insufficient reward points at time of deduction", 409);
            }

            await RewardTransaction.create(
              [
                {
                  user: userId,
                  type: "redeem",
                  points: booking.rewardPointsRedeemed,
                  balanceBefore: Number(
                    (rewardUser.rewardPoints + booking.rewardPointsRedeemed).toFixed(2)
                  ),
                  balanceAfter: Number(rewardUser.rewardPoints.toFixed(2)),
                  bookingId: booking._id,
                },
              ],
              { session }
            );
          }

          const canEarnReward =
            Number(booking.rewardPointsRedeemed || 0) === 0 &&
            Number(booking.amount || 0) >= 450;
          const earnedPoints = canEarnReward
            ? Number((amount * REWARD_EARN_RATE).toFixed(2))
            : 0;

          if (earnedPoints > 0) {
            const rewardUser = await User.findByIdAndUpdate(
              userId,
              { $inc: { rewardPoints: earnedPoints } },
              { new: true, session }
            );

            if (!rewardUser) {
              throw createHttpError("User not found for reward credit", 404);
            }

            await RewardTransaction.create(
              [
                {
                  user: userId,
                  type: "earn",
                  points: earnedPoints,
                  balanceBefore: Number(
                    (rewardUser.rewardPoints - earnedPoints).toFixed(2)
                  ),
                  balanceAfter: Number(rewardUser.rewardPoints.toFixed(2)),
                  bookingId: booking._id,
                },
              ],
              { session }
            );
          }

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
                  note: `Movie booking payment (${booking._id})`,
                  booking: booking._id,
                  payment: payment._id,
                },
              ],
              { session }
            );
          }

          await session.commitTransaction();

          try {
            await finalizeSeatLocksAfterBooking({
              showId,
              seatIds,
              bookingId: booking._id,
              userId: booking.userId,
            });
          } catch (realtimeError) {
            console.error("Post-wallet booking seat cleanup failed:", realtimeError);
          }

          return {
            success: true,
            bookingId: String(booking._id),
            paymentId,
            walletBalance: balanceAfter,
            earnedPoints,
            showId,
          };
        } catch (error) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }

          throw error;
        } finally {
          session.endSession();
        }
      },
    });

    return res.json(result);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Wallet payment failed",
    });
  }
};

// GET /payment/transactions?limit=10&page=1
export const getPaymentTransactions = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);

    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 50)
        : 10;
    const page =
      Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const skip = (page - 1) * limit;

    const basePipeline = [
      {
        $lookup: {
          from: "bookings",
          localField: "bookingId",
          foreignField: "_id",
          as: "movieBooking",
        },
      },
      {
        $lookup: {
          from: "sportbookings",
          localField: "bookingId",
          foreignField: "_id",
          as: "sportBooking",
        },
      },
      {
        $addFields: {
          movieBooking: { $arrayElemAt: ["$movieBooking", 0] },
          sportBooking: { $arrayElemAt: ["$sportBooking", 0] },
        },
      },
      {
        $addFields: {
          booking: { $ifNull: ["$movieBooking", "$sportBooking"] },
          bookingType: {
            $cond: [
              { $ne: ["$movieBooking", null] },
              "movie",
              {
                $cond: [{ $ne: ["$sportBooking", null] }, "sport", null],
              },
            ],
          },
        },
      },
      { $match: { "booking.userId": userId } },
      {
        $addFields: {
          itemObjectId: {
            $cond: [
              { $eq: ["$bookingType", "movie"] },
              {
                $convert: {
                  input: "$booking.itemId",
                  to: "objectId",
                  onError: null,
                  onNull: null,
                },
              },
              null,
            ],
          },
        },
      },
      {
        $lookup: {
          from: "movies",
          localField: "itemObjectId",
          foreignField: "_id",
          as: "movie",
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      { $unwind: { path: "$movie", preserveNullAndEmptyArrays: true } },
    ];

    const [countResult, rows, statsResult] = await Promise.all([
      Payment.aggregate([...basePipeline, { $count: "total" }]),
      Payment.aggregate([
        ...basePipeline,
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            id: { $ifNull: ["$paymentId", { $toString: "$_id" }] },
            paymentId: "$paymentId",
            orderId: "$orderId",
            bookingId: "$booking._id",
            matchId: "$booking.matchId",
            league: "$booking.league",
            matchNo: "$booking.matchNo",
            teams: "$booking.teams",
            venue: "$booking.venue",
            title: {
              $cond: [
                { $eq: ["$bookingType", "sport"] },
                {
                  $ifNull: [
                    "$booking.teams.label",
                    {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$booking.teams.teamA", false] },
                            { $ifNull: ["$booking.teams.teamB", false] },
                          ],
                        },
                        {
                          $concat: [
                            "$booking.teams.teamA",
                            " vs ",
                            "$booking.teams.teamB",
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: ["$booking.league", false] },
                            {
                              $cond: [
                                { $ifNull: ["$booking.matchNo", false] },
                                {
                                  $concat: [
                                    "$booking.league",
                                    " • ",
                                    "$booking.matchNo",
                                  ],
                                },
                                "$booking.league",
                              ],
                            },
                            "Sport booking",
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  $ifNull: [
                    "$movie.name",
                    { $concat: ["Booking - ", "$booking.cinemaId"] },
                  ],
                },
              ],
            },
            showType: {
              $cond: [
                { $eq: ["$bookingType", "sport"] },
                { $ifNull: ["$booking.sportType", "sport"] },
                { $ifNull: ["$booking.showType", { $ifNull: ["$bookingType", "N/A"] }] },
              ],
            },
            booking: {
              _id: "$booking._id",
              showType: {
                $cond: [
                  { $eq: ["$bookingType", "sport"] },
                  { $ifNull: ["$booking.sportType", "sport"] },
                  {
                    $ifNull: ["$booking.showType", { $ifNull: ["$bookingType", "N/A"] }],
                  },
                ],
              },
            },
            date: "$createdAt",
            method: "$method",
            amount: "$amount",
            status: "$status",
          },
        },
      ]),
      Payment.aggregate([
        ...basePipeline,
        {
          $group: {
            _id: null,
            totalSpent: {
              $sum: {
                $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
              },
            },
            successfulBookings: {
              $sum: {
                $cond: [{ $eq: ["$status", "success"] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalSpent: { $round: ["$totalSpent", 2] },
            successfulBookings: 1,
          },
        },
      ]),
    ]);

    const total = countResult[0]?.total || 0;
    const hasMore = skip + rows.length < total;
    const stats = statsResult[0] || { totalSpent: 0, successfulBookings: 0 };

    let transactions = rows;
    const hasSports = rows.some((row) => Boolean(row.matchId));

    if (hasSports) {
      const sportsData = await loadSportsData();
      const sportsMap = new Map(
        sportsData
          .filter((item) => item && item._id)
          .map((item) => [item._id, item])
      );

      transactions = rows.map((row) => {
        if (!row.matchId) {
          return row;
        }

        const match = sportsMap.get(row.matchId);
        const title = buildSportTitle(match, row);
        const details = buildSportDetails(match, row);
        const sportShowType = match?.genres?.[0] || row.showType;

        return {
          ...row,
          title,
          details: details || null,
          showType: sportShowType,
          booking: row.booking
            ? {
                ...row.booking,
                showType: sportShowType,
              }
            : row.booking,
        };
      });
    }

    return res.json({
      page,
      limit,
      total,
      hasMore,
      stats,
      transactions,
    });
  } catch (err) {
    console.error("getPaymentTransactions error:", err);
    return res.status(500).json({ message: "Failed to fetch payment transactions" });
  }
};

// POST /payment/export-statement
export const exportStatement = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const type = String(req.body?.type || "").toLowerCase();
    if (!["wallet", "reward", "booking"].includes(type)) {
      return res.status(400).json({ message: "Invalid statement type" });
    }

    const user = await User.findById(userId).select("name email");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const alreadyExportedToday = await ExportLog.findOne({
      user: userId,
      exportedAt: { $gte: startOfToday, $lte: endOfToday },
    });

    if (alreadyExportedToday) {
      return res
        .status(429)
        .json({ message: "You can download only one statement per day." });
    }

    let rows = [];
    if (type === "wallet") {
      const walletRows = await WalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      rows = walletRows.map((item) => ({
        date: item.createdAt,
        type: item.type || "-",
        source: item.source || "-",
        amount: Number(item.amount || 0),
        status: item.status || "-",
        balanceAfter: Number(item.balanceAfter || 0),
      }));
    }

    if (type === "reward") {
      const rewardRows = await RewardTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      rows = rewardRows.map((item) => ({
        date: item.createdAt,
        type: item.type || "-",
        source: "reward_points",
        amount: Number(item.points || 0),
        status: "success",
        balanceAfter: Number(item.balanceAfter || 0),
      }));
    }

    if (type === "booking") {
      const paymentRows = await Payment.aggregate([
        {
          $lookup: {
            from: "bookings",
            localField: "bookingId",
            foreignField: "_id",
            as: "booking",
          },
        },
        { $unwind: "$booking" },
        { $match: { "booking.userId": String(userId) } },
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
      ]);

      rows = paymentRows
        .map((item) => ({
          date: item.createdAt,
          type: "booking_payment",
          source: item.method || "-",
          amount: Number(item.amount || 0),
          status: item.status || "-",
        }));
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Statement");

    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "MOVIEBOOK";
    sheet.getCell("A1").font = { bold: true, size: 18 };
    sheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };

    sheet.mergeCells("A2:F2");
    sheet.getCell("A2").value = "Account Statement";
    sheet.getCell("A2").font = { size: 12, bold: true };

    sheet.mergeCells("A3:F3");
    sheet.getCell("A3").value = `Downloaded By: ${user.name || "User"}`;
    sheet.mergeCells("A4:F4");
    sheet.getCell("A4").value = `Email: ${user.email || "-"}`;
    sheet.mergeCells("A5:F5");
    sheet.getCell("A5").value = `Download Time: ${new Date().toLocaleString("en-IN")}`;
    sheet.mergeCells("A6:F6");
    sheet.getCell("A6").value = `Statement Type: ${type}`;
    sheet.mergeCells("A7:F7");
    sheet.getCell("A7").value =
      "------------------------------------------------------------";

    const headerRowIndex = 9;
    const headerRow = sheet.getRow(headerRowIndex);
    headerRow.values = [
      "Date",
      "Type",
      "Source",
      "Amount",
      "Status",
      "Balance After",
    ];
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF4FF" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    if (rows.length === 0) {
      const emptyRow = sheet.addRow([
        "No transactions found",
        "",
        "",
        "",
        "",
        "",
      ]);
      emptyRow.getCell(1).font = { italic: true };
    } else {
      for (const item of rows) {
        const dataRow = sheet.addRow([
          item.date ? new Date(item.date) : "",
          item.type,
          item.source,
          Number(item.amount || 0),
          item.status,
          Number(item.balanceAfter || 0),
        ]);

        dataRow.getCell(1).numFmt = "dd-mmm-yyyy hh:mm";
        dataRow.getCell(4).numFmt = '"₹"#,##0.00';
        dataRow.getCell(6).numFmt = '"₹"#,##0.00';
      }
    }

    sheet.columns = [
      { key: "date", width: 24 },
      { key: "type", width: 20 },
      { key: "source", width: 24 },
      { key: "amount", width: 16 },
      { key: "status", width: 16 },
      { key: "balanceAfter", width: 20 },
    ];

    for (let rowIndex = headerRowIndex + 1; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      row.alignment = { vertical: "middle", horizontal: "left" };
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFEEEEEE" } },
          left: { style: "thin", color: { argb: "FFEEEEEE" } },
          bottom: { style: "thin", color: { argb: "FFEEEEEE" } },
          right: { style: "thin", color: { argb: "FFEEEEEE" } },
        };
      });
    }

    await ExportLog.create({
      user: userId,
      type,
      exportedAt: new Date(),
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=statement.xlsx");

    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error("exportStatement error:", err);
    return res.status(500).json({ message: "Failed to export statement" });
  }
};
