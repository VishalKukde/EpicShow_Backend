import Booking from "../../movies/models/Booking.js";
import Payment from "../../movies/models/Payment.js";
import { parseShowDateTime } from "../../../utils/Helper.js";

export const getGamingBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
      showType: "gaming",
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const showDateTime = parseShowDateTime(booking.date, booking.slot);
    const now = new Date();
    const EXPIRE_ELIGIBLE = ["pending", "paid"];

    if (showDateTime < now && EXPIRE_ELIGIBLE.includes(booking.status)) {
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

export const getGamingBookings = async (req, res) => {
  try {
    const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "0"), 10);

    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1
      ? 0
      : Math.min(parsedLimit, 50);
    const usePagination = limit > 0;
    const skip = usePagination ? (page - 1) * limit : 0;

    const basePipeline = [
      { $match: { userId: req.user.id } },
      { $match: { showType: "gaming" } },
      {
        $addFields: {
          itemId: { $toObjectId: "$itemId" },
        },
      },
      {
        $lookup: {
          from: "gamings",
          localField: "itemId",
          foreignField: "_id",
          as: "show",
          pipeline: [{ $project: { title: 1, imageUrl: 1, venue: 1, city: 1 } }],
        },
      },
      { $unwind: { path: "$show", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          show: {
            name: { $ifNull: ["$show.title", "Gaming"] },
            imageUrl: "$show.imageUrl",
          },
          cinemaId: {
            $cond: [
              { $and: ["$show.venue", "$show.city"] },
              { $concat: ["$show.venue", ", ", "$show.city"] },
              { $ifNull: ["$show.venue", "$cinemaId"] },
            ],
          },
        },
      },
      {
        $addFields: {
          hour: { $toInt: { $substr: ["$slot", 0, 2] } },
          minute: { $substr: ["$slot", 3, 2] },
          period: { $substr: ["$slot", 6, 2] },
        },
      },
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
        $addFields: {
          status: {
            $cond: [
              { $lt: ["$showDateTime", "$$NOW"] },
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
    });
  } catch (err) {
    console.error("Error fetching gaming bookings:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gaming bookings",
    });
  }
};
