import Seat from "../models/Seat.js";
import SeatStatus from "../models/SeatStatus.js";
import crypto from "crypto";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js"
import User from "../models/User.js";
import RewardTransaction from "../models/RewardTransaction.js";
import ExportLog from "../models/ExportLog.js";
import { WalletTransaction } from "../models/WalletTransaction.js";
import { razorpay } from "../config/razorpay.js";

const MIN_REWARD_POINTS_TO_ELIGIBLE = 150;
const REWARD_REDEEM_POINTS = 100;
const REWARD_REDEEM_DISCOUNT = 100;
const REWARD_EARN_RATE = 0.1;

export const preparePayment = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId || req.body.user;
    const {
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatIds,
      coupon,
      redeemReward = false,
    } = req.body;

    // 🛑 Validation
    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    if (
      !movieId ||
      !cinemaId ||
      !showDate ||
      !showSlot ||
      !seatIds ||
      !seatIds.length ||
      !userId
    ) {
      return res.status(400).json({ message: "Missing booking details" });
    }

    // 1️⃣ Get cinema layout
    const cinema = await Seat.findOne({ cinemaId });

    if (!cinema) {
      return res.status(404).json({ message: "Cinema not found" });
    }

    // 2️⃣ Get seat locks for this show + selected seats
    const seatLocks = await SeatStatus.find({
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatId: { $in: seatIds }
    });

    // ❌ If any seat not locked
    if (seatLocks.length !== seatIds.length) {
      return res.status(400).json({
        message: "Some seats are no longer locked"
      });
    }

    // ❌ If any seat locked by someone else
    const foreignLock = seatLocks.find(
      s => s.lockedBy !== userId
    );

    if (foreignLock) {
      return res.status(409).json({
        message: "Some seats are locked by another user"
      });
    }

    // 3️⃣ Secure total calculation
    let total = 0;

    for (const row of cinema.seats) {
      for (const seat of row.seats) {
        if (seatIds.includes(seat.seatId)) {
          total += seat.price;
        }
      }
    }

    if (coupon && redeemReward) {
      return res
        .status(400)
        .json({ message: "Coupon and reward redemption cannot be applied together" });
    }

    // 4️⃣ Coupon
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

    // ✅ DO NOT insert locks again (already locked earlier)

    // 5️⃣ Return verified payment data
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
      cinemaId,
      movieId,
      showDate,
      showSlot,
      seatIds,
      coupon,
      showType,
      redeemReward = false,
    } = req.body;

    if (!cinemaId || !movieId || !showDate || !showSlot || !seatIds?.length || !userId) {
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

    // 🔒 1️⃣ Validate seats are locked by this user
    const lockedSeats = await SeatStatus.find({
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatId: { $in: seatIds },
      lockedBy: userId,
      status: "locked"
    }).session(session);

    if (lockedSeats.length !== seatIds.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Seats are not properly locked" });
    }

    // 🔐 2️⃣ Recalculate amount securely (your original logic kept)
    const cinema = await Seat.findOne({ cinemaId }).session(session);

    if (!cinema) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Cinema not found" });
    }

    let total = 0;

    for (const row of cinema.seats) {
      for (const seat of row.seats) {
        if (seatIds.includes(seat.seatId)) {
          total += seat.price;
        }
      }
    }

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


    // 🧾 3️⃣ Create booking (PENDING)
    const [createdBooking] = await Booking.create(
      [
        {
          userId,
          itemId: movieId,
          cinemaId,
          date: showDate,
          slot: showSlot,
          seatIds,
          amount: total,
          coupon: coupon ? coupon.code : null,
          showType,
          rewardPointsRedeemed: rewardPointsToRedeem,
          rewardDiscount,
        },
      ],
      { session }
    );

    // 💳 4️⃣ Create Razorpay order
    const order = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: createdBooking._id.toString() // link booking
    });

    // 📝 Save razorpayOrderId inside booking
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
      bookingId
    } = req.body;

    // 🔐 1️⃣ Verify Signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(sign)
      .digest("hex");

    if (expectedSign !== razorpay_signature) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // 🔍 2️⃣ Fetch existing booking
    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Booking not found" });
    }

    // 🚫 3️⃣ Prevent double verification
    if (booking.status === "paid") {
      await session.abortTransaction();
      return res.json({ success: true, message: "Already verified" });
    }

    // 💳 4️⃣ Fetch payment details from Razorpay (optional but recommended)
    const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

    // 💰 5️⃣ Update booking
    booking.status = "paid";
    booking.paymentId = razorpay_payment_id;
    await booking.save({ session });

    // 🎟 6️⃣ Convert locked seats → sold
    const seatUpdate = await SeatStatus.updateMany(
      {
        movieId: new mongoose.Types.ObjectId(booking.itemId),
        cinemaId: booking.cinemaId,
        showDate: booking.date,
        showSlot: booking.slot,
        seatId: { $in: booking.seatIds },
        lockedBy: booking.userId,
        status: "locked"
      },
      {
        $set: {
          status: "sold",
          expireAt: null
        }
      },
      { session }
    );

    if (seatUpdate.modifiedCount !== booking.seatIds.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Seat conversion failed" });
    }

    // 💳 7️⃣ Create Payment record
    const payment = new Payment({
      bookingId: booking._id,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      method: paymentDetails.method,
      amount: booking.amount,
      currency: paymentDetails.currency,
      status: "success"
    });

    await payment.save({ session });

    // ⭐ 8️⃣ Deduct redeemed reward points only on successful booking
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

    // ⭐ 9️⃣ Award reward points only when:
    // - user did NOT redeem reward points for this booking
    // - booking amount is greater than ₹450
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

    const lockedSeats = await SeatStatus.find({
      movieId: booking.itemId,
      cinemaId: booking.cinemaId,
      showDate: booking.date,
      showSlot: booking.slot,
      seatId: { $in: booking.seatIds },
      lockedBy: booking.userId,
      status: "locked",
    }).session(session);

    if (lockedSeats.length !== booking.seatIds.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Seats are not properly locked" });
    }

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

    const seatUpdate = await SeatStatus.updateMany(
      {
        movieId: booking.itemId,
        cinemaId: booking.cinemaId,
        showDate: booking.date,
        showSlot: booking.slot,
        seatId: { $in: booking.seatIds },
        lockedBy: booking.userId,
        status: "locked",
      },
      {
        $set: {
          status: "sold",
          expireAt: null,
        },
      },
      { session }
    );

    if (seatUpdate.modifiedCount !== booking.seatIds.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Seat conversion failed" });
    }

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

    // Deduct redeemed reward points only after successful booking
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

    // ⭐ Reward points only when:
    // - user did NOT redeem reward points for this booking
    // - booking amount is greater than ₹450
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
            note: `Movie booking payment (${booking._id})`,
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
          as: "booking",
        },
      },
      { $unwind: "$booking" },
      { $match: { "booking.userId": userId } },
      {
        $addFields: {
          itemObjectId: {
            $convert: {
              input: "$booking.itemId",
              to: "objectId",
              onError: null,
              onNull: null,
            },
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
            title: {
              $ifNull: [
                "$movie.name",
                { $concat: ["Booking - ", "$booking.cinemaId"] },
              ],
            },
            showType: { $ifNull: ["$booking.showType", "N/A"] },
            booking: {
              _id: "$booking._id",
              showType: { $ifNull: ["$booking.showType", "N/A"] },
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

    return res.json({
      page,
      limit,
      total,
      hasMore,
      stats,
      transactions: rows,
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
