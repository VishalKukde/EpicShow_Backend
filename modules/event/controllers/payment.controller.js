import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../../movies/models/Booking.js";
import Payment from "../../movies/models/Payment.js";
import User from "../../user/model/User.js";
import RewardTransaction from "../../wallet/model/RewardTransaction.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";
import Event from "../models/Event.js";

const MIN_REWARD_POINTS_TO_ELIGIBLE = 150;
const REWARD_REDEEM_POINTS = 100;
const REWARD_REDEEM_DISCOUNT = 100;
const REWARD_EARN_RATE = 0.1;

export const preparePayment = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId || req.body.user;
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

    const resolvedItemId = itemId || eventId || movieId;

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    if (!resolvedItemId || !cinemaId || !showDate || !showSlot) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    if (coupon && redeemReward) {
      return res
        .status(400)
        .json({ message: "Coupon and reward redemption cannot be applied together" });
    }

    const event = await Event.findById(resolvedItemId).select("price");
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    let total = Number(event.price || 0);

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
      verifiedSeats: seatIds,
      rewardDiscount,
      rewardPointsToRedeem,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Payment validation failed" });
  }
};

export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user?.id || req.body.userId || req.body.user;
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

    const resolvedItemId = itemId || eventId || movieId;
    const resolvedShowType = showType || "event";

    if (!cinemaId || !resolvedItemId || !showDate || !showSlot || !userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (coupon && redeemReward) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ message: "Coupon and reward redemption cannot be applied together" });
    }

    const event = await Event.findById(resolvedItemId).select("price").session(session);
    if (!event) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Event not found" });
    }

    let total = Number(event.price || 0);

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
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "User not found" });
      }

      if (rewardUser.rewardPoints < MIN_REWARD_POINTS_TO_ELIGIBLE) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ message: "At least 150 reward points are required to redeem" });
      }

      rewardPointsToRedeem = REWARD_REDEEM_POINTS;
      rewardDiscount = REWARD_REDEEM_DISCOUNT;
      total -= rewardDiscount;

      if (total < 0) {
        total = 0;
      }

      if (rewardUser.rewardPoints < rewardPointsToRedeem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Insufficient reward points" });
      }
    }

    if (total < 0) {
      total = 0;
    }

    const [createdBooking] = await Booking.create(
      [
        {
          userId,
          itemId: resolvedItemId,
          cinemaId,
          date: showDate,
          slot: showSlot,
          seatIds,
          amount: total,
          coupon: coupon ? coupon.code : null,
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
    session.endSession();

    res.json({
      bookingId: createdBooking._id,
      razorpayOrderId: order.id,
      amount: total,
      currency: "INR",
      rewardDiscount,
      rewardPointsRedeemed: rewardPointsToRedeem,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ message: "Order creation failed" });
  }
};

export const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

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
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "paid") {
      await session.abortTransaction();
      return res.json({ success: true, message: "Already verified" });
    }

    const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

    booking.status = "paid";
    booking.paymentId = razorpay_payment_id;
    await booking.save({ session });

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
        await session.abortTransaction();
        return res
          .status(409)
          .json({ message: "Insufficient reward points at time of deduction" });
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
        await session.abortTransaction();
        return res.status(404).json({ message: "User not found for reward credit" });
      }

      await RewardTransaction.create(
        [
          {
            user: booking.userId,
            type: "earn",
            points: earnedPoints,
            balanceBefore: Number((rewardUser.rewardPoints - earnedPoints).toFixed(2)),
            balanceAfter: Number(rewardUser.rewardPoints.toFixed(2)),
            bookingId: booking._id,
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      earnedPoints,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ message: "Payment verification failed" });
  }
};

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

export const payWithWallet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user?.id;
    const { bookingId } = req.body;

    if (!userId || !bookingId) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Missing booking details" });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status === "paid") {
      const existingPayment = await Payment.findOne({ bookingId: booking._id }).session(
        session
      );
      await session.commitTransaction();
      session.endSession();
      return res.json({
        success: true,
        bookingId: booking._id,
        alreadyPaid: true,
        paymentId: existingPayment?.paymentId || null,
        earnedPoints: 0,
      });
    }

    if (booking.status !== "pending") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Booking is not payable" });
    }

    const amount = Number((booking.amount ?? 0).toFixed(2));

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User not found" });
    }

    const balanceBefore = Number((user.walletBalance ?? 0).toFixed(2));
    if (amount > balanceBefore) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const balanceAfter = Number((balanceBefore - amount).toFixed(2));

    if (amount > 0) {
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, walletBalance: { $gte: amount } },
        { $inc: { walletBalance: -amount } },
        { new: true, session }
      );

      if (!updatedUser) {
        await session.abortTransaction();
        return res.status(409).json({ message: "Unable to deduct wallet balance" });
      }
    }

    const paymentId = `${booking._id}_${Date.now()}`;
    booking.status = "paid";
    booking.paymentId = paymentId;
    await booking.save({ session });

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
        await session.abortTransaction();
        return res
          .status(409)
          .json({ message: "Insufficient reward points at time of deduction" });
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
        await session.abortTransaction();
        return res.status(404).json({ message: "User not found for reward credit" });
      }

      await RewardTransaction.create(
        [
          {
            user: userId,
            type: "earn",
            points: earnedPoints,
            balanceBefore: Number((rewardUser.rewardPoints - earnedPoints).toFixed(2)),
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
    session.endSession();

    return res.json({
      success: true,
      bookingId: booking._id,
      paymentId,
      walletBalance: balanceAfter,
      earnedPoints,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ message: "Wallet payment failed" });
  }
};
