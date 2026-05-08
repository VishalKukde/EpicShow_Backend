import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../../movies/models/Booking.js";
import Payment from "../../movies/models/Payment.js";
import User from "../../user/model/User.js";
import RewardTransaction from "../../wallet/model/RewardTransaction.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";
import Event from "../models/Event.js";
import {
  markCollectedCouponUsed,
  resolveCouponApplication,
} from "../../offers/service/offers.service.js";
import {
  assertTicketLimitForMembership,
  getRewardEarnRateForMembership,
} from "../../subscription/service/pro-perks.service.js";
import {
  createBookedSeatsForBooking,
  ensureSeatsNotBooked,
  finalizeSeatLocksAfterBooking,
  resolveBookingShowId,
  withPaymentIdempotency,
} from "../../movies/services/booking-finalization.service.js";
import { assertSeatLocksOwnedByUser } from "../../movies/services/seat-lock.service.js";
import { buildShowId, normalizeString, toIdString } from "../../movies/utils/show.utils.js";

const MIN_REWARD_POINTS_TO_ELIGIBLE = 150;
const REWARD_REDEEM_POINTS = 100;
const REWARD_REDEEM_DISCOUNT = 100;
const REWARD_EARN_RATE = 0.1;

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

const resolveEventShowContext = ({ movieId, eventId, itemId, cinemaId, showDate, showSlot }) => {
  const resolvedItemId = toIdString(itemId || eventId || movieId);
  const resolvedCinemaId = normalizeString(cinemaId);
  const resolvedShowDate = normalizeString(showDate);
  const resolvedShowSlot = normalizeString(showSlot);

  return {
    itemId: resolvedItemId,
    cinemaId: resolvedCinemaId,
    showDate: resolvedShowDate,
    showSlot: resolvedShowSlot,
    showId: buildShowId({
      itemId: resolvedItemId,
      cinemaId: resolvedCinemaId,
      showDate: resolvedShowDate,
      showSlot: resolvedShowSlot,
    }),
  };
};

const assertEventSeatsReadyForPayment = async ({ showId, seatIds, userId, session = null }) => {
  const [availability, lockState] = await Promise.all([
    ensureSeatsNotBooked({
      showId,
      seatIds,
      session,
    }),
    assertSeatLocksOwnedByUser({
      showId,
      seatIds,
      userId,
    }),
  ]);

  if (!availability.available || !lockState.valid) {
    throw createHttpError("Seat no longer available", 409);
  }
};

const calculateEventTotal = (event) => Math.max(Number(event?.price || 0), 0);

export const preparePayment = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id || req.body.userId || req.body.user);
    const {
      movieId,
      eventId,
      itemId,
      cinemaId,
      showDate,
      showSlot,
      seatIds = [],
      coupon,
      redeemReward = false,
    } = req.body;

    const showContext = resolveEventShowContext({
      movieId,
      eventId,
      itemId,
      cinemaId,
      showDate,
      showSlot,
    });
    const normalizedSeatIds = normalizeSeatIds(seatIds);

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    if (!showContext.showId || normalizedSeatIds.length === 0) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    assertTicketLimitForMembership(normalizedSeatIds, req.user?.membership);

    if (coupon && redeemReward) {
      return res.status(400).json({
        message: "Coupon and reward redemption cannot be applied together",
      });
    }

    const event = await Event.findById(showContext.itemId).select("price");
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    await assertEventSeatsReadyForPayment({
      showId: showContext.showId,
      seatIds: normalizedSeatIds,
      userId,
    });

    let total = calculateEventTotal(event);
    let couponApplication = null;
    let rewardDiscount = 0;
    let rewardPointsToRedeem = 0;

    if (coupon) {
      couponApplication = await resolveCouponApplication({
        userId,
        couponInput: coupon,
        amount: total,
        bookingType: "event",
      });
      total = Math.max(total - couponApplication.discountAmount, 0);
    }

    if (redeemReward) {
      const user = await User.findById(userId).select("rewardPoints");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.rewardPoints < MIN_REWARD_POINTS_TO_ELIGIBLE) {
        return res.status(400).json({
          message: "At least 150 reward points are required to redeem",
        });
      }

      if (user.rewardPoints < REWARD_REDEEM_POINTS) {
        return res.status(400).json({ message: "Insufficient reward points" });
      }

      rewardDiscount = REWARD_REDEEM_DISCOUNT;
      rewardPointsToRedeem = REWARD_REDEEM_POINTS;
      total = Math.max(total - rewardDiscount, 0);
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
      movieId,
      eventId,
      itemId,
      cinemaId,
      showDate,
      showSlot,
      seatIds = [],
      coupon,
      showType,
      redeemReward = false,
    } = req.body;

    const showContext = resolveEventShowContext({
      movieId,
      eventId,
      itemId,
      cinemaId,
      showDate,
      showSlot,
    });
    const normalizedSeatIds = normalizeSeatIds(seatIds);
    const resolvedShowType = normalizeString(showType) || "event";

    if (!showContext.showId || normalizedSeatIds.length === 0 || !userId) {
      throw createHttpError("Missing required fields", 400);
    }

    assertTicketLimitForMembership(normalizedSeatIds, req.user?.membership);

    if (coupon && redeemReward) {
      throw createHttpError(
        "Coupon and reward redemption cannot be applied together",
        400
      );
    }

    const event = await Event.findById(showContext.itemId).select("price").session(session);
    if (!event) {
      throw createHttpError("Event not found", 404);
    }

    await assertEventSeatsReadyForPayment({
      showId: showContext.showId,
      seatIds: normalizedSeatIds,
      userId,
      session,
    });

    let total = calculateEventTotal(event);
    let couponApplication = null;
    let rewardDiscount = 0;
    let rewardPointsToRedeem = 0;

    if (coupon) {
      couponApplication = await resolveCouponApplication({
        userId,
        couponInput: coupon,
        amount: total,
        bookingType: "event",
        session,
      });
      total = Math.max(total - couponApplication.discountAmount, 0);
    }

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
      total = Math.max(total - rewardDiscount, 0);

      if (rewardUser.rewardPoints < rewardPointsToRedeem) {
        throw createHttpError("Insufficient reward points", 400);
      }
    }

    const [createdBooking] = await Booking.create(
      [
        {
          userId,
          itemId: showContext.itemId,
          cinemaId: showContext.cinemaId,
          date: showContext.showDate,
          slot: showContext.showSlot,
          showId: showContext.showId,
          seatIds: normalizedSeatIds,
          amount: total,
          coupon: couponApplication ? couponApplication.code : null,
          couponId: couponApplication ? couponApplication.couponId : null,
          userCouponId: couponApplication ? couponApplication.userCouponId : null,
          couponDiscount: couponApplication ? couponApplication.discountAmount : 0,
          showType: resolvedShowType,
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
      idempotencyKey: `event:razorpay:${razorpay_payment_id}`,
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

          await assertEventSeatsReadyForPayment({
            showId,
            seatIds,
            userId: booking.userId,
            session,
          });

          booking.status = "paid";
          booking.paymentId = razorpay_payment_id;
          booking.showId = showId;
          booking.seatIds = seatIds;
          await booking.save({ session });

          await createBookedSeatsForBooking({
            booking,
            paymentId: razorpay_payment_id,
            showType: booking.showType || "event",
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

          if (booking.userCouponId) {
            await markCollectedCouponUsed({
              userId: booking.userId,
              userCouponId: booking.userCouponId,
              bookingId: booking._id,
              session,
            });
          }

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
          const earningUser = canEarnReward
            ? await User.findById(booking.userId).select("membership").session(session)
            : null;
          const rewardEarnRate = getRewardEarnRateForMembership(
            REWARD_EARN_RATE,
            earningUser?.membership
          );
          const earnedPoints = canEarnReward
            ? Number((Number(booking.amount || 0) * rewardEarnRate).toFixed(2))
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
            console.error("Post-event booking seat cleanup failed:", realtimeError);
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

export const markPaymentFailed = async (req, res) => {
  try {
    const { bookingId } = req.body;

    await Booking.findByIdAndUpdate(bookingId, {
      status: "failed",
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Failed to update payment status" });
  }
};

export const payWithWallet = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id);
    const { bookingId } = req.body;

    if (!userId || !bookingId) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    const result = await withPaymentIdempotency({
      idempotencyKey: `event:wallet:${bookingId}`,
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

          await assertEventSeatsReadyForPayment({
            showId,
            seatIds,
            userId: booking.userId,
            session,
          });

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
            showType: booking.showType || "event",
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

          if (booking.userCouponId) {
            await markCollectedCouponUsed({
              userId,
              userCouponId: booking.userCouponId,
              bookingId: booking._id,
              session,
            });
          }

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
          const rewardEarnRate = getRewardEarnRateForMembership(
            REWARD_EARN_RATE,
            user.membership
          );
          const earnedPoints = canEarnReward
            ? Number((amount * rewardEarnRate).toFixed(2))
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
                  note: `Event booking payment (${booking._id})`,
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
            console.error("Post-event wallet seat cleanup failed:", realtimeError);
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
