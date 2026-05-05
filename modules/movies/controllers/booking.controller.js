import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import {parseShowDateTime} from "../../../utils/Helper.js"
import Movie from "../models/Movie.js";
import mongoose from "mongoose";

export const getBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const showDateTime = parseShowDateTime(booking.date, booking.slot);

    const now = new Date();
    const EXPIRE_ELIGIBLE = ["pending", "paid"];

    // ✅ Mark as expired if past
    if (
      showDateTime < now &&
      EXPIRE_ELIGIBLE.includes(booking.status)
    ) {
      booking.status = "expired";
      await booking.save();
    }

    const payment = await Payment.findOne({
      bookingId: booking._id,
    });

    res.json({
      booking,
      payment,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch booking" });
  }
};



export const getAllMovieBookings = async (req, res) => {
  try {
    const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "0"), 10);

    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1
      ? 0
      : Math.min(parsedLimit, 50);
    const usePagination = limit > 0;
    const skip = usePagination ? (page - 1) * limit : 0;
    const reviewableStatuses = ["paid", "expired", "booked", "BOOKED"];

    const basePipeline = [
      { $match: { userId: req.user.id } },
      { $match: { showType: "movie" } },
      {
        $addFields: {
          bookingStatusRaw: "$status",
          itemId: { $toObjectId: "$itemId" },
        },
      },

      {
        $lookup: {
          from: "movies",
          localField: "itemId",
          foreignField: "_id",
          as: "show",
          pipeline: [{ $project: { name: 1, imageUrl: 1 } }],
        },
      },
      { $unwind: { path: "$show", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "payments",
          localField: "_id",
          foreignField: "bookingId",
          as: "payment",
          pipeline: [{ $project: { status: 1, method: 1, amount: 1 } }],
        },
      },
      { $unwind: { path: "$payment", preserveNullAndEmptyArrays: true } },

      // ⭐ Extract hour & minute
      {
        $addFields: {
          hour: { $toInt: { $substr: ["$slot", 0, 2] } },
          minute: { $substr: ["$slot", 3, 2] },
          period: { $substr: ["$slot", 6, 2] },
        },
      },

      // ⭐ Convert to 24-hour
      {
        $addFields: {
          hour24: {
            $cond: [
              { $eq: ["$period", "PM"] },
              {
                $cond: [
                  { $eq: ["$hour", 12] },
                  12,
                  { $add: ["$hour", 12] },
                ],
              },
              {
                $cond: [
                  { $eq: ["$hour", 12] },
                  0,
                  "$hour",
                ],
              },
            ],
          },
        },
      },

      // ⭐ Build datetime string
      {
        $addFields: {
          showDateTime: {
            $dateFromString: {
              dateString: {
                $concat: [
                  "$date",
                  "T",
                  {
                    $cond: [
                      { $lt: ["$hour24", 10] },
                      { $concat: ["0", { $toString: "$hour24" }] },
                      { $toString: "$hour24" },
                    ],
                  },
                  ":",
                  "$minute",
                  ":00",
                ],
              },
              timezone: "Asia/Kolkata",
            },
          },
        },
      },

      {
        $lookup: {
          from: "reviews",
          let: { bookingId: { $toString: "$_id" } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$booking_id", "$$bookingId"],
                },
              },
            },
            {
              $project: {
                _id: 1,
                rating: 1,
                created_at: 1,
              },
            },
          ],
          as: "reviewDocs",
        },
      },

      // ⭐ Expire logic + review actions
      {
        $addFields: {
          showTime: "$showDateTime",
          showTimePassed: { $lt: ["$showDateTime", "$$NOW"] },
          reviewSubmitted: {
            $gt: [{ $size: "$reviewDocs" }, 0],
          },
          reviewId: {
            $ifNull: [{ $arrayElemAt: ["$reviewDocs._id", 0] }, null],
          },
          canReview: {
            $and: [
              { $lt: ["$showDateTime", "$$NOW"] },
              { $in: ["$bookingStatusRaw", reviewableStatuses] },
              { $eq: [{ $size: "$reviewDocs" }, 0] },
            ],
          },
          status: {
            $cond: [
              {
                $and: [
                  { $lt: ["$showDateTime", "$$NOW"] },
                  { $in: ["$bookingStatusRaw", ["pending", "paid"]] },
                ],
              },
              "expired",
              "$status",
            ],
          },
        },
      },

      {
        $project: {
          hour: 0,
          minute: 0,
          period: 0,
          hour24: 0,
          showDateTime: 0,
          reviewDocs: 0,
          bookingStatusRaw: 0,
        },
      },
    ];

    let bookings = [];
    let totalCount = 0;

    if (usePagination) {
      const [{ data = [], meta = [] } = {}] = await Booking.aggregate([
        ...basePipeline,
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            meta: [{ $count: "total" }],
          },
        },
      ]);

      bookings = data;
      totalCount = meta[0]?.total ?? 0;
    } else {
      bookings = await Booking.aggregate([
        ...basePipeline,
        { $sort: { createdAt: -1 } },
      ]);
      totalCount = bookings.length;
    }

    res.status(200).json({
      success: true,
      count: bookings.length,
      totalCount,
      data: bookings,
      pagination: {
        page,
        limit: usePagination ? limit : totalCount,
        total: totalCount,
        hasMore: usePagination ? skip + bookings.length < totalCount : false,
      },
    })
  } catch (error) {
    console.error("Error fetching bookings:", error)

    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings",
      error: error.message,
    })
  }
}

// Cancelled Booking 
export const cancelBooking = async (req, res) => {

  const session = await mongoose.startSession();
session.startTransaction();

  try {
    const userId = req.user.id;
    const bookingId = req.params.id;

    const booking = await Booking.findOne({
      _id: bookingId,
      userId: userId,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      })
    }

    // ❌ Cannot cancel if already cancelled
    if (booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Booking already cancelled",
      })
    }

    // ❌ Cannot cancel expired
    if (booking.status === "expired") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel expired booking",
      })
    }

    const payment = await Payment.findOne({
      bookingId: booking._id,
    });

    if (!payment) {
    await session.abortTransaction();
    session.endSession();
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

   booking.status = "cancelled";
  await booking.save({ session });

  payment.status = "refund_initiated";
  await payment.save({ session });

  // ✅ Commit only if BOTH succeed
  await session.commitTransaction();
  session.endSession();

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      data: booking,
    })

  } catch (error) {
    console.error("Cancel booking error:", error)

    return res.status(500).json({
      success: false,
      message: "Failed to cancel booking",
      error: error.message,
    })
  }
}


export const getUserBookingStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const totalBookings = await Booking.countDocuments({ userId:userId });

    const paidBookings = await Booking.find({
      userId: userId,
      status: "paid",
    });

    const upcomingPaidBookings = paidBookings.filter((b) => {
      const showDateTime = parseShowDateTime(b.date, b.slot);
      return showDateTime > now;
    }).length;

    res.json({
      stats: {
        totalBookings,
        upcomingPaidBookings,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch booking stats" });
  }
};

// to get latest 4 bookings
export const getLatestBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const bookings = await Booking.find({
      userId: userId,
      status: "paid",
    })
      .sort({ createdAt: -1 })
      .limit(4)
      .lean();

    const modelMap = {
      movie: Movie
      // sport: Sport,
      // gaming: Gaming,
    };

    const results = await Promise.all(
      bookings.map(async (booking) => {
        const Model = modelMap[booking.showType];
        const item = Model
          ? await Model.findById(booking.itemId).lean()
          : null;

        return { booking, item };
      })
    );

    res.json({ bookings: results });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch latest bookings" });
  }
};

// export const getAllEventBookings = async (req, res) => {
//   try {
//     const bookings = await Booking.find({ type: "movie" }).sort({
//       createdAt: -1,
//     });

//     res.status(200).json({
//       success: true,
//       data: bookings,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch bookings",
//       error: error.message,
//     });
//   }
// };

// export const getAllSportsBookings = async (req, res) => {
//   try {
//     const bookings = await Booking.find({ type: "movie" }).sort({
//       createdAt: -1,
//     });

//     res.status(200).json({
//       success: true,
//       data: bookings,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch bookings",
//       error: error.message,
//     });
//   }
// };
