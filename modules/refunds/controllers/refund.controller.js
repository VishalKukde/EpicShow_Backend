
import Payment from "../../movies/models/Payment.js";

export const getRefundTransactions = async (req, res) => {
  try {
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page =
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.floor(rawPage)
        : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 50)
        : 10;
    const skip = (page - 1) * limit;
    const userId = String(req.user.id);

    const [{ data = [], meta = [], stats = [], types = [] } = {}] =
      await Payment.aggregate([
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
            isSportBooking: {
              $cond: [{ $ifNull: ["$sportBooking._id", false] }, true, false],
            },
          },
        },
        {
          $match: {
            status: { $in: ["refunded", "refund_initiated"] },
            "booking.userId": userId,
          },
        },
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
            as: "movieDoc",
            pipeline: [{ $project: { name: 1, imageUrl: 1 } }],
          },
        },
        {
          $lookup: {
            from: "events",
            localField: "itemObjectId",
            foreignField: "_id",
            as: "eventDoc",
            pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
          },
        },
        {
          $lookup: {
            from: "gamings",
            localField: "itemObjectId",
            foreignField: "_id",
            as: "gamingDoc",
            pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
          },
        },
        {
          $lookup: {
            from: "wallettransactions",
            let: { paymentObjectId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$payment", "$$paymentObjectId"] },
                  source: "refund",
                  type: "credit",
                },
              },
              { $sort: { createdAt: -1 } },
              { $limit: 1 },
            ],
            as: "walletRefund",
          },
        },
        {
          $addFields: {
            movieDoc: { $arrayElemAt: ["$movieDoc", 0] },
            eventDoc: { $arrayElemAt: ["$eventDoc", 0] },
            gamingDoc: { $arrayElemAt: ["$gamingDoc", 0] },
            walletRefund: { $arrayElemAt: ["$walletRefund", 0] },
          },
        },
        {
          $addFields: {
            bookingType: {
              $cond: [
                "$isSportBooking",
                "sports",
                { $ifNull: ["$booking.showType", "movies"] },
              ],
            },
            refundAmount: { $ifNull: ["$walletRefund.amount", "$amount", "$booking.amount", 0] },
            refundDate: { $ifNull: ["$walletRefund.createdAt", "$updatedAt", "$createdAt"] },
            bookingDate: { $ifNull: ["$booking.date", "$booking.schedule.date"] },
            bookingSlot: { $ifNull: ["$booking.slot", "$booking.schedule.time"] },
            ticketCount: { $size: { $ifNull: ["$booking.seatIds", []] } },
            walletBalanceAfter: "$walletRefund.balanceAfter",
          },
        },
        {
          $addFields: {
            bookingTitle: {
              $switch: {
                branches: [
                  {
                    case: "$isSportBooking",
                    then: {
                      $ifNull: [
                        "$booking.teams.label",
                        {
                          $concat: [
                            { $ifNull: ["$booking.teams.teamA", "Team A"] },
                            " vs ",
                            { $ifNull: ["$booking.teams.teamB", "Team B"] },
                          ],
                        },
                      ],
                    },
                  },
                  {
                    case: { $eq: ["$bookingType", "event"] },
                    then: { $ifNull: ["$eventDoc.title", "Event booking"] },
                  },
                  {
                    case: { $eq: ["$bookingType", "gaming"] },
                    then: { $ifNull: ["$gamingDoc.title", "Gaming booking"] },
                  },
                ],
                default: { $ifNull: ["$movieDoc.name", "Movie booking"] },
              },
            },
            bookingVenue: {
              $switch: {
                branches: [
                  {
                    case: "$isSportBooking",
                    then: {
                      $ifNull: [
                        {
                          $cond: [
                            { $and: ["$booking.venue.name", "$booking.venue.city"] },
                            { $concat: ["$booking.venue.name", ", ", "$booking.venue.city"] },
                            "$booking.venue.name",
                          ],
                        },
                        "Stadium TBD",
                      ],
                    },
                  },
                  {
                    case: { $eq: ["$bookingType", "event"] },
                    then: {
                      $ifNull: [
                        {
                          $cond: [
                            { $and: ["$eventDoc.venue", "$eventDoc.city"] },
                            { $concat: ["$eventDoc.venue", ", ", "$eventDoc.city"] },
                            "$eventDoc.venue",
                          ],
                        },
                        "$booking.cinemaId",
                      ],
                    },
                  },
                  {
                    case: { $eq: ["$bookingType", "gaming"] },
                    then: {
                      $ifNull: [
                        {
                          $cond: [
                            { $and: ["$gamingDoc.venue", "$gamingDoc.city"] },
                            { $concat: ["$gamingDoc.venue", ", ", "$gamingDoc.city"] },
                            "$gamingDoc.venue",
                          ],
                        },
                        "$booking.cinemaId",
                      ],
                    },
                  },
                ],
                default: { $ifNull: ["$booking.cinemaId", "Venue TBD"] },
              },
            },
            posterUrl: {
              $switch: {
                branches: [
                  { case: { $eq: ["$bookingType", "event"] }, then: "$eventDoc.imageUrl" },
                  { case: { $eq: ["$bookingType", "gaming"] }, then: "$gamingDoc.imageUrl" },
                ],
                default: "$movieDoc.imageUrl",
              },
            },
          },
        },
        {
          $facet: {
            data: [
              { $sort: { refundDate: -1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  _id: 0,
                  id: { $toString: "$_id" },
                  bookingId: { $toString: "$bookingId" },
                  orderId: 1,
                  paymentId: 1,
                  refundId: { $ifNull: ["$refundId", ""] },
                  status: "$status",
                  refundAmount: { $round: ["$refundAmount", 2] },
                  paymentAmount: { $round: ["$amount", 2] },
                  currency: { $ifNull: ["$currency", "INR"] },
                  paymentMethod: { $ifNull: ["$method", "wallet"] },
                  bookingStatus: "$booking.status",
                  bookingType: 1,
                  bookingTitle: 1,
                  bookingVenue: { $ifNull: ["$bookingVenue", "Venue TBD"] },
                  bookingDate: 1,
                  bookingSlot: 1,
                  seatIds: { $ifNull: ["$booking.seatIds", []] },
                  ticketCount: 1,
                  coupon: "$booking.coupon",
                  couponDiscount: { $ifNull: ["$booking.couponDiscount", 0] },
                  rewardPointsRedeemed: { $ifNull: ["$booking.rewardPointsRedeemed", 0] },
                  rewardDiscount: { $ifNull: ["$booking.rewardDiscount", 0] },
                  walletBalanceAfter: 1,
                  note: "$walletRefund.note",
                  bookedAt: "$booking.createdAt",
                  refundedAt: "$refundDate",
                  createdAt: 1,
                  posterUrl: 1,
                },
              },
            ],
            meta: [{ $count: "total" }],
            stats: [
              {
                $group: {
                  _id: null,
                  totalRefunds: { $sum: 1 },
                  totalAmount: { $sum: "$refundAmount" },
                  completed: { $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] } },
                  pending: { $sum: { $cond: [{ $eq: ["$status", "refund_initiated"] }, 1, 0] } },
                },
              },
            ],
            types: [
              {
                $group: {
                  _id: "$bookingType",
                  count: { $sum: 1 },
                  amount: { $sum: "$refundAmount" },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]);

    const total = meta[0]?.total || 0;
    const summary = stats[0] || {};

    return res.json({
      refunds: data,
      stats: {
        totalRefunds: summary.totalRefunds || 0,
        totalAmount: Number((summary.totalAmount || 0).toFixed(2)),
        completed: summary.completed || 0,
        pending: summary.pending || 0,
        byType: types.map((item) => ({
          type: item._id || "booking",
          count: item.count || 0,
          amount: Number((item.amount || 0).toFixed(2)),
        })),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        hasMore: skip + data.length < total,
      },
    });
  } catch (err) {
    console.error("getRefundTransactions error:", err);
    return res.status(500).json({ message: "Failed to fetch refund history" });
  }
};