import crypto from "crypto";
import Payment from "../../movies/models/Payment.js";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";

const MIN_TOPUP = 1;
const MAX_TOPUP = 5000;
const BOOSTER_THRESHOLD = 1000;
const BOOSTER_RATE = 0.05;

function normalizeAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return null;
  return Number(amount.toFixed(2));
}

function calculateRewardBonus(amount) {
  if (amount < BOOSTER_THRESHOLD) return 0;
  return Number((amount * BOOSTER_RATE).toFixed(2));
}

export const createWalletOrder = async (req, res) => {
  try {
    const amount = normalizeAmount(req.body?.amount);

    if (amount === null) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (amount < MIN_TOPUP || amount > MAX_TOPUP) {
      return res.status(400).json({
        message: `Amount should be between ${MIN_TOPUP} and ${MAX_TOPUP}`,
      });
    }

    const user = await User.findById(req.user.id).select("walletBalance");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const walletBalance = Number((user.walletBalance ?? 0).toFixed(2));
    const remainingLimit = Number((MAX_TOPUP - walletBalance).toFixed(2));
    const bonusAmount = calculateRewardBonus(amount);
    const totalCredit = Number((amount + bonusAmount).toFixed(2));

    if (remainingLimit < MIN_TOPUP) {
      return res.status(400).json({ message: "Wallet limit reached (5000.00)" });
    }

    if (amount > remainingLimit || totalCredit > remainingLimit) {
      return res.status(400).json({
        message: `This top-up exceeds wallet limit after reward bonus. Available space: ₹${remainingLimit.toFixed(
          2
        )}`,
      });
    }

    const amountInPaise = Math.round(amount * 100);
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `${req.user.id}_${Date.now()}`,
      notes: {
        type: "wallet_topup",
        userId: req.user.id,
        amount: amount.toFixed(2),
        bonusAmount: bonusAmount.toFixed(2),
      },
    });

    res.json({
      orderId: order.id,
      amount,
      bonusAmount,
      currency: "INR",
    });
  } catch (err) {
    console.error("createWalletOrder error:", err);
    res.status(500).json({ message: "Failed to create wallet order" });
  }
};

export const verifyWalletPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment details" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    const creditedAmount = Number((payment.amount / 100).toFixed(2));
    const bonusAmount = calculateRewardBonus(creditedAmount);
    const totalCreditedAmount = Number((creditedAmount + bonusAmount).toFixed(2));

    if (creditedAmount < MIN_TOPUP || creditedAmount > MAX_TOPUP) {
      return res.status(400).json({ message: "Amount outside wallet limits" });
    }

    const maxAllowedBalance = Number((MAX_TOPUP - totalCreditedAmount).toFixed(2));

    const user = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        walletBalance: { $lte: maxAllowedBalance },
      },
      { $inc: { walletBalance: totalCreditedAmount } },
      { new: true }
    );

    if (!user) {
      const existingUser = await User.findById(req.user.id).select("_id");
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      return res
        .status(400)
        .json({ message: "Wallet limit exceeded. Max wallet amount is 5000.00" });
    }

    const balanceAfter = Number(user.walletBalance.toFixed(2));
    const balanceBefore = Number((balanceAfter - totalCreditedAmount).toFixed(2));
    const topupBalanceAfter = Number((balanceBefore + creditedAmount).toFixed(2));

    const transactionDocs = [
      {
        user: req.user.id,
        type: "credit",
        source: "topup",
        amount: creditedAmount,
        balanceBefore,
        balanceAfter: topupBalanceAfter,
        status: "success",
        note: `Wallet top-up via Razorpay (${razorpay_payment_id})`,
      },
    ];

    if (bonusAmount > 0) {
      transactionDocs.push({
        user: req.user.id,
        type: "credit",
        source: "reward_bonus",
        amount: bonusAmount,
        balanceBefore: topupBalanceAfter,
        balanceAfter,
        status: "success",
        note: "Reward booster bonus (5%)",
      });
    }

    await WalletTransaction.create(transactionDocs);

    return res.json({
      message: "Wallet credited successfully",
      walletBalance: balanceAfter,
      creditedAmount,
      bonusAmount,
      totalCreditedAmount,
    });
  } catch (err) {
    console.error("verifyWalletPayment error:", err);
    res.status(500).json({ message: "Payment verification failed" });
  }
};

export const getWalletTransactions = async (req, res) => {
  try {
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page =
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.floor(rawPage)
        : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 100)
        : 20;
    const skip = (page - 1) * limit;

    const total = await WalletTransaction.countDocuments({ user: req.user.id });

    const transactions = await WalletTransaction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({
      transactions: transactions.map((txn) => ({
        id: String(txn._id),
        type: txn.type,
        source: txn.source,
        amount: Number(txn.amount.toFixed(2)),
        balanceBefore: Number(txn.balanceBefore.toFixed(2)),
        balanceAfter: Number(txn.balanceAfter.toFixed(2)),
        status: txn.status,
        note: txn.note || "",
        createdAt: txn.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + transactions.length < total,
      },
    });
  } catch (err) {
    console.error("getWalletTransactions error:", err);
    return res.status(500).json({ message: "Failed to fetch wallet transactions" });
  }
};

// export const getRefundTransactions = async (req, res) => {
//   try {
//     const rawPage = Number(req.query.page);
//     const rawLimit = Number(req.query.limit);
//     const page =
//       Number.isFinite(rawPage) && rawPage > 0
//         ? Math.floor(rawPage)
//         : 1;
//     const limit =
//       Number.isFinite(rawLimit) && rawLimit > 0
//         ? Math.min(Math.floor(rawLimit), 50)
//         : 10;
//     const skip = (page - 1) * limit;
//     const userId = String(req.user.id);

//     const [{ data = [], meta = [], stats = [], types = [] } = {}] =
//       await Payment.aggregate([
//         {
//           $lookup: {
//             from: "bookings",
//             localField: "bookingId",
//             foreignField: "_id",
//             as: "movieBooking",
//           },
//         },
//         {
//           $lookup: {
//             from: "sportbookings",
//             localField: "bookingId",
//             foreignField: "_id",
//             as: "sportBooking",
//           },
//         },
//         {
//           $addFields: {
//             movieBooking: { $arrayElemAt: ["$movieBooking", 0] },
//             sportBooking: { $arrayElemAt: ["$sportBooking", 0] },
//           },
//         },
//         {
//           $addFields: {
//             booking: { $ifNull: ["$movieBooking", "$sportBooking"] },
//             isSportBooking: {
//               $cond: [{ $ifNull: ["$sportBooking._id", false] }, true, false],
//             },
//           },
//         },
//         {
//           $match: {
//             status: { $in: ["refunded", "refund_initiated"] },
//             "booking.userId": userId,
//           },
//         },
//         {
//           $addFields: {
//             itemObjectId: {
//               $convert: {
//                 input: "$booking.itemId",
//                 to: "objectId",
//                 onError: null,
//                 onNull: null,
//               },
//             },
//           },
//         },
//         {
//           $lookup: {
//             from: "movies",
//             localField: "itemObjectId",
//             foreignField: "_id",
//             as: "movieDoc",
//             pipeline: [{ $project: { name: 1, imageUrl: 1 } }],
//           },
//         },
//         {
//           $lookup: {
//             from: "events",
//             localField: "itemObjectId",
//             foreignField: "_id",
//             as: "eventDoc",
//             pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
//           },
//         },
//         {
//           $lookup: {
//             from: "gamings",
//             localField: "itemObjectId",
//             foreignField: "_id",
//             as: "gamingDoc",
//             pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
//           },
//         },
//         {
//           $lookup: {
//             from: "wallettransactions",
//             let: { paymentObjectId: "$_id" },
//             pipeline: [
//               {
//                 $match: {
//                   $expr: { $eq: ["$payment", "$$paymentObjectId"] },
//                   source: "refund",
//                   type: "credit",
//                 },
//               },
//               { $sort: { createdAt: -1 } },
//               { $limit: 1 },
//             ],
//             as: "walletRefund",
//           },
//         },
//         {
//           $addFields: {
//             movieDoc: { $arrayElemAt: ["$movieDoc", 0] },
//             eventDoc: { $arrayElemAt: ["$eventDoc", 0] },
//             gamingDoc: { $arrayElemAt: ["$gamingDoc", 0] },
//             walletRefund: { $arrayElemAt: ["$walletRefund", 0] },
//           },
//         },
//         {
//           $addFields: {
//             bookingType: {
//               $cond: [
//                 "$isSportBooking",
//                 "sports",
//                 { $ifNull: ["$booking.showType", "movies"] },
//               ],
//             },
//             refundAmount: { $ifNull: ["$walletRefund.amount", "$amount", "$booking.amount", 0] },
//             refundDate: { $ifNull: ["$walletRefund.createdAt", "$updatedAt", "$createdAt"] },
//             bookingDate: { $ifNull: ["$booking.date", "$booking.schedule.date"] },
//             bookingSlot: { $ifNull: ["$booking.slot", "$booking.schedule.time"] },
//             ticketCount: { $size: { $ifNull: ["$booking.seatIds", []] } },
//             walletBalanceAfter: "$walletRefund.balanceAfter",
//           },
//         },
//         {
//           $addFields: {
//             bookingTitle: {
//               $switch: {
//                 branches: [
//                   {
//                     case: "$isSportBooking",
//                     then: {
//                       $ifNull: [
//                         "$booking.teams.label",
//                         {
//                           $concat: [
//                             { $ifNull: ["$booking.teams.teamA", "Team A"] },
//                             " vs ",
//                             { $ifNull: ["$booking.teams.teamB", "Team B"] },
//                           ],
//                         },
//                       ],
//                     },
//                   },
//                   {
//                     case: { $eq: ["$bookingType", "event"] },
//                     then: { $ifNull: ["$eventDoc.title", "Event booking"] },
//                   },
//                   {
//                     case: { $eq: ["$bookingType", "gaming"] },
//                     then: { $ifNull: ["$gamingDoc.title", "Gaming booking"] },
//                   },
//                 ],
//                 default: { $ifNull: ["$movieDoc.name", "Movie booking"] },
//               },
//             },
//             bookingVenue: {
//               $switch: {
//                 branches: [
//                   {
//                     case: "$isSportBooking",
//                     then: {
//                       $ifNull: [
//                         {
//                           $cond: [
//                             { $and: ["$booking.venue.name", "$booking.venue.city"] },
//                             { $concat: ["$booking.venue.name", ", ", "$booking.venue.city"] },
//                             "$booking.venue.name",
//                           ],
//                         },
//                         "Stadium TBD",
//                       ],
//                     },
//                   },
//                   {
//                     case: { $eq: ["$bookingType", "event"] },
//                     then: {
//                       $ifNull: [
//                         {
//                           $cond: [
//                             { $and: ["$eventDoc.venue", "$eventDoc.city"] },
//                             { $concat: ["$eventDoc.venue", ", ", "$eventDoc.city"] },
//                             "$eventDoc.venue",
//                           ],
//                         },
//                         "$booking.cinemaId",
//                       ],
//                     },
//                   },
//                   {
//                     case: { $eq: ["$bookingType", "gaming"] },
//                     then: {
//                       $ifNull: [
//                         {
//                           $cond: [
//                             { $and: ["$gamingDoc.venue", "$gamingDoc.city"] },
//                             { $concat: ["$gamingDoc.venue", ", ", "$gamingDoc.city"] },
//                             "$gamingDoc.venue",
//                           ],
//                         },
//                         "$booking.cinemaId",
//                       ],
//                     },
//                   },
//                 ],
//                 default: { $ifNull: ["$booking.cinemaId", "Venue TBD"] },
//               },
//             },
//             posterUrl: {
//               $switch: {
//                 branches: [
//                   { case: { $eq: ["$bookingType", "event"] }, then: "$eventDoc.imageUrl" },
//                   { case: { $eq: ["$bookingType", "gaming"] }, then: "$gamingDoc.imageUrl" },
//                 ],
//                 default: "$movieDoc.imageUrl",
//               },
//             },
//           },
//         },
//         {
//           $facet: {
//             data: [
//               { $sort: { refundDate: -1 } },
//               { $skip: skip },
//               { $limit: limit },
//               {
//                 $project: {
//                   _id: 0,
//                   id: { $toString: "$_id" },
//                   bookingId: { $toString: "$bookingId" },
//                   orderId: 1,
//                   paymentId: 1,
//                   refundId: { $ifNull: ["$refundId", ""] },
//                   status: "$status",
//                   refundAmount: { $round: ["$refundAmount", 2] },
//                   paymentAmount: { $round: ["$amount", 2] },
//                   currency: { $ifNull: ["$currency", "INR"] },
//                   paymentMethod: { $ifNull: ["$method", "wallet"] },
//                   bookingStatus: "$booking.status",
//                   bookingType: 1,
//                   bookingTitle: 1,
//                   bookingVenue: { $ifNull: ["$bookingVenue", "Venue TBD"] },
//                   bookingDate: 1,
//                   bookingSlot: 1,
//                   seatIds: { $ifNull: ["$booking.seatIds", []] },
//                   ticketCount: 1,
//                   coupon: "$booking.coupon",
//                   couponDiscount: { $ifNull: ["$booking.couponDiscount", 0] },
//                   rewardPointsRedeemed: { $ifNull: ["$booking.rewardPointsRedeemed", 0] },
//                   rewardDiscount: { $ifNull: ["$booking.rewardDiscount", 0] },
//                   walletBalanceAfter: 1,
//                   note: "$walletRefund.note",
//                   bookedAt: "$booking.createdAt",
//                   refundedAt: "$refundDate",
//                   createdAt: 1,
//                   posterUrl: 1,
//                 },
//               },
//             ],
//             meta: [{ $count: "total" }],
//             stats: [
//               {
//                 $group: {
//                   _id: null,
//                   totalRefunds: { $sum: 1 },
//                   totalAmount: { $sum: "$refundAmount" },
//                   completed: { $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] } },
//                   pending: { $sum: { $cond: [{ $eq: ["$status", "refund_initiated"] }, 1, 0] } },
//                 },
//               },
//             ],
//             types: [
//               {
//                 $group: {
//                   _id: "$bookingType",
//                   count: { $sum: 1 },
//                   amount: { $sum: "$refundAmount" },
//                 },
//               },
//               { $sort: { _id: 1 } },
//             ],
//           },
//         },
//       ]);

//     const total = meta[0]?.total || 0;
//     const summary = stats[0] || {};

//     return res.json({
//       refunds: data,
//       stats: {
//         totalRefunds: summary.totalRefunds || 0,
//         totalAmount: Number((summary.totalAmount || 0).toFixed(2)),
//         completed: summary.completed || 0,
//         pending: summary.pending || 0,
//         byType: types.map((item) => ({
//           type: item._id || "booking",
//           count: item.count || 0,
//           amount: Number((item.amount || 0).toFixed(2)),
//         })),
//       },
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.max(Math.ceil(total / limit), 1),
//         hasMore: skip + data.length < total,
//       },
//     });
//   } catch (err) {
//     console.error("getRefundTransactions error:", err);
//     return res.status(500).json({ message: "Failed to fetch refund history" });
//   }
// };
