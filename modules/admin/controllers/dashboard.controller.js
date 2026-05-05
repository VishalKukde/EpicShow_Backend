import Booking from "../../movies/models/Booking.js";
import Payment from "../../movies/models/Payment.js";
import SportBooking from "../../sports/models/Booking.js";
import Event from "../../event/models/Event.js";
import Gaming from "../../gaming/models/Gaming.js";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import Notification from "../../notifications/model/Notification.js";
import { emitUserNotification } from "../../chat/socket/chat.socket.js";
import { razorpay } from "../../../config/razorpay.js";

const TYPE_CONFIG = {
  movies: {
    label: "Movies",
    match: { showType: "movie" },
    lookup: {
      from: "movies",
      localField: "itemObjectId",
      foreignField: "_id",
      as: "showDoc",
      pipeline: [{ $project: { name: 1, imageUrl: 1 } }],
    },
    title: { $ifNull: ["$showDoc.name", "Movie"] },
    theater: "$cinemaId",
    collection: Booking,
  },
  events: {
    label: "Events",
    match: { showType: "event" },
    lookup: {
      from: "events",
      localField: "itemObjectId",
      foreignField: "_id",
      as: "showDoc",
      pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
    },
    title: { $ifNull: ["$showDoc.title", "Event"] },
    theater: {
      $ifNull: [
        {
          $cond: [
            { $and: ["$showDoc.venue", "$showDoc.city"] },
            { $concat: ["$showDoc.venue", ", ", "$showDoc.city"] },
            "$showDoc.venue",
          ],
        },
        "$cinemaId",
      ],
    },
    collection: Booking,
  },
  gaming: {
    label: "Gaming",
    match: { showType: "gaming" },
    lookup: {
      from: "gamings",
      localField: "itemObjectId",
      foreignField: "_id",
      as: "showDoc",
      pipeline: [{ $project: { title: 1, venue: 1, city: 1, imageUrl: 1 } }],
    },
    title: { $ifNull: ["$showDoc.title", "Gaming"] },
    theater: {
      $ifNull: [
        {
          $cond: [
            { $and: ["$showDoc.venue", "$showDoc.city"] },
            { $concat: ["$showDoc.venue", ", ", "$showDoc.city"] },
            "$showDoc.venue",
          ],
        },
        "$cinemaId",
      ],
    },
    collection: Booking,
  },
};

const STATUS_OPTIONS = ["pending", "paid", "failed", "cancelled", "expired"];
const PAYMENT_STATUS_OPTIONS = ["paid", "failed", "refunded", "refund_initiated"];
const PAYMENT_METHOD_OPTIONS = ["upi", "card", "wallet", "netbanking"];
const TIME_RANGES = new Set(["today", "7d", "30d", "90d"]);

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin access required" });
    return false;
  }
  return true;
}

function getDateRange(range) {
  if (!TIME_RANGES.has(range)) return null;

  const now = new Date();
  const start = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    start.setDate(now.getDate() - 7);
  } else if (range === "30d") {
    start.setDate(now.getDate() - 30);
  } else if (range === "90d") {
    start.setDate(now.getDate() - 90);
  }

  return { $gte: start, $lte: now };
}

function money(value) {
  return Number(value || 0);
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function baseBookingPipeline(config) {
  return [
    { $match: config.match },
    {
      $addFields: {
        itemObjectId: {
          $convert: {
            input: "$itemId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
        userObjectId: {
          $convert: {
            input: "$userId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    { $lookup: config.lookup },
    { $unwind: { path: "$showDoc", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "userObjectId",
        foreignField: "_id",
        as: "userDoc",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        title: config.title,
        userName: { $ifNull: ["$userDoc.name", "$userDoc.email", "Guest User"] },
        userEmail: { $ifNull: ["$userDoc.email", "No email"] },
        theater: { $ifNull: [config.theater, "Venue TBD"] },
        ticketCount: { $size: { $ifNull: ["$seatIds", []] } },
        saleAmount: { $cond: [{ $eq: ["$status", "paid"] }, { $ifNull: ["$amount", 0] }, 0] },
        bookingTime: "$createdAt",
      },
    },
  ];
}

function sportBasePipeline() {
  return [
    {
      $addFields: {
        userObjectId: {
          $convert: {
            input: "$userId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userObjectId",
        foreignField: "_id",
        as: "userDoc",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        title: {
          $ifNull: [
            "$teams.label",
            {
              $concat: [
                { $ifNull: ["$teams.teamA", "Team A"] },
                " vs ",
                { $ifNull: ["$teams.teamB", "Team B"] },
              ],
            },
          ],
        },
        userName: { $ifNull: ["$userDoc.name", "$userDoc.email", "Guest User"] },
        userEmail: { $ifNull: ["$userDoc.email", "No email"] },
        theater: {
          $ifNull: [
            {
              $cond: [
                { $and: ["$venue.name", "$venue.city"] },
                { $concat: ["$venue.name", ", ", "$venue.city"] },
                "$venue.name",
              ],
            },
            "Stadium TBD",
          ],
        },
        ticketCount: { $size: { $ifNull: ["$seatIds", []] } },
        saleAmount: { $cond: [{ $eq: ["$status", "paid"] }, { $ifNull: ["$amount", 0] }, 0] },
        bookingTime: "$createdAt",
        showType: { $ifNull: ["$sportType", "sports"] },
      },
    },
  ];
}

function ordersBasePipeline() {
  return [
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
      },
    },
    {
      $addFields: {
        userObjectId: {
          $convert: {
            input: "$booking.userId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "userObjectId",
        foreignField: "_id",
        as: "userDoc",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        paymentStatus: {
          $cond: [
            { $eq: ["$status", "success"] },
            "paid",
            {
              $cond: [
                { $eq: ["$status", "refund_initiated"] },
                "refund_initiated",
                {
                  $cond: [
                    { $in: ["$status", ["refunded"]] },
                    "refunded",
                    {
                      $cond: [
                        { $eq: ["$booking.status", "refunded"] },
                        "refunded",
                        "failed",
                      ],
                    },
                  ],
                },
              ],
            }
          ],
        },
        userName: { $ifNull: ["$userDoc.name", "Guest User"] },
        userEmail: { $ifNull: ["$userDoc.email", "No email"] },
        bookingStatus: { $ifNull: ["$booking.status", "unknown"] },
        ticketCount: { $size: { $ifNull: ["$booking.seatIds", []] } },
        totalAmount: { $ifNull: ["$amount", "$booking.amount", 0] },
        paymentMethod: { $ifNull: ["$method", "wallet"] },
        createdDate: "$createdAt",
        bookingType: {
          $cond: [
            { $ifNull: ["$sportBooking._id", false] },
            "sports",
            { $ifNull: ["$booking.showType", "movies"] },
          ],
        },
        bookingTitle: {
          $cond: [
            { $ifNull: ["$sportBooking._id", false] },
            {
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
            { $ifNull: ["$booking.itemId", "Movie booking"] },
          ],
        },
        bookingVenue: {
          $cond: [
            { $ifNull: ["$sportBooking._id", false] },
            {
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
            { $ifNull: ["$booking.cinemaId", "Venue TBD"] },
          ],
        },
        bookingDate: { $ifNull: ["$booking.date", "$booking.schedule.date"] },
        bookingSlot: { $ifNull: ["$booking.slot", "$booking.schedule.time"] },
        seatIds: { $ifNull: ["$booking.seatIds", []] },
        coupon: "$booking.coupon",
        couponDiscount: { $ifNull: ["$booking.couponDiscount", 0] },
        rewardPointsRedeemed: { $ifNull: ["$booking.rewardPointsRedeemed", 0] },
        rewardDiscount: { $ifNull: ["$booking.rewardDiscount", 0] },
        refundId: "$refundId",
        currency: { $ifNull: ["$currency", "INR"] },
      },
    },
  ];
}

async function typeStats(type) {
  const pipeline = type === "sports" ? sportBasePipeline() : baseBookingPipeline(TYPE_CONFIG[type]);
  const collection = type === "sports" ? SportBooking : TYPE_CONFIG[type].collection;
  const [stats = {}] = await collection.aggregate([
    ...pipeline,
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        totalTickets: { $sum: "$ticketCount" },
        totalSales: { $sum: "$saleAmount" },
        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        refunds: { $sum: { $cond: [{ $in: ["$status", ["cancelled", "refunded"]] }, 1, 0] } },
      },
    },
  ]);

  return {
    totalBookings: stats.totalBookings || 0,
    totalTickets: stats.totalTickets || 0,
    totalSales: money(stats.totalSales),
    pending: stats.pending || 0,
    refunds: stats.refunds || 0,
    averageOrderValue: stats.totalBookings ? Math.round(money(stats.totalSales) / stats.totalBookings) : 0,
  };
}

export const getAdminDashboard = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const [
      movieStats,
      eventStats,
      gamingStats,
      sportStats,
      activeEvents,
      activeGaming,
      movieVenues,
      sportVenues,
      totalUsers,
      orderStats,
    ] = await Promise.all([
      typeStats("movies"),
      typeStats("events"),
      typeStats("gaming"),
      typeStats("sports"),
      Event.countDocuments({ endDateTime: { $gte: new Date() } }),
      Gaming.countDocuments({ endDateTime: { $gte: new Date() } }),
      Booking.distinct("cinemaId", { showType: "movie", cinemaId: { $nin: [null, ""] } }),
      SportBooking.distinct("venue.id", { "venue.id": { $nin: [null, ""] } }),
      User.countDocuments({}),
      Payment.aggregate([
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            paidOrders: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
            failedOrders: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            refundedOrders: { $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const categories = [
      { type: "movies", label: "Movies", ...movieStats },
      { type: "sports", label: "Sports", ...sportStats },
      { type: "events", label: "Events", ...eventStats },
      { type: "gaming", label: "Gaming", ...gamingStats },
    ];

    const totalBookings = categories.reduce((sum, item) => sum + item.totalBookings, 0);
    const revenue = categories.reduce((sum, item) => sum + item.totalSales, 0);
    const pendingRefunds = categories.reduce((sum, item) => sum + item.refunds, 0);
    const orders = orderStats[0] || {};

    const currentYear = new Date().getFullYear();
    const bookingMonthly = await Booking.aggregate([
      { $match: { status: "paid", createdAt: { $gte: new Date(`${currentYear}-01-01`) } } },
      { $group: { _id: { $month: "$createdAt" }, revenue: { $sum: { $ifNull: ["$amount", 0] } } } },
    ]);
    const sportMonthly = await SportBooking.aggregate([
      { $match: { status: "paid", createdAt: { $gte: new Date(`${currentYear}-01-01`) } } },
      { $group: { _id: { $month: "$createdAt" }, revenue: { $sum: { $ifNull: ["$amount", 0] } } } },
    ]);

    const monthlyRevenue = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const value = [...bookingMonthly, ...sportMonthly]
        .filter((item) => item._id === month)
        .reduce((sum, item) => sum + item.revenue, 0);
      return {
        month: new Date(currentYear, index, 1).toLocaleString("en-IN", { month: "short" }),
        revenue: money(value),
      };
    });

    res.json({
      success: true,
      data: {
        kpis: {
          totalBookings,
          revenue,
          pendingRefunds,
          activeVenues: activeEvents + activeGaming + movieVenues.length + sportVenues.length,
          totalUsers,
          totalOrders: orders.totalOrders || 0,
          paidOrders: orders.paidOrders || 0,
          failedOrders: orders.failedOrders || 0,
          refundedOrders: orders.refundedOrders || 0,
        },
        monthlyRevenue,
        categorySplits: categories.map((item) => ({
          type: item.type,
          label: item.label,
          bookings: item.totalBookings,
          revenue: item.totalSales,
          percent: percent(item.totalBookings, totalBookings),
        })),
        categoryStats: categories,
      },
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ success: false, message: "Failed to load admin dashboard" });
  }
};

export const getAdminBookings = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const type = String(req.params.type || "movies").toLowerCase();
    if (!["movies", "sports", "events", "gaming"].includes(type)) {
      return res.status(400).json({ success: false, message: "Unsupported booking type" });
    }

    const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "10"), 10) || 10, 1), 50);
    const status = STATUS_OPTIONS.includes(req.query.status) ? req.query.status : "";
    const theater = String(req.query.theater || "").trim();
    const timeRange = getDateRange(req.query.time);

    const pipeline = type === "sports" ? sportBasePipeline() : baseBookingPipeline(TYPE_CONFIG[type]);
    const collection = type === "sports" ? SportBooking : TYPE_CONFIG[type].collection;

    const filters = {};
    if (status) filters.status = status;
    if (theater) filters.theater = theater;
    if (timeRange) filters.createdAt = timeRange;

    const [{ data = [], meta = [], venues = [], stats = [] } = {}] = await collection.aggregate([
      ...pipeline,
      { $match: filters },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                title: 1,
                userName: 1,
                userEmail: 1,
                status: 1,
                bookingTime: 1,
                theater: 1,
                ticketCount: 1,
                saleAmount: 1,
                itemId: 1,
                showId: 1,
                matchId: 1,
                sportType: 1,
                league: 1,
                matchNo: 1,
                teams: 1,
                schedule: 1,
                venue: 1,
                date: 1,
                slot: 1,
                seatIds: 1,
                amount: 1,
                coupon: 1,
                couponDiscount: 1,
                rewardPointsRedeemed: 1,
                rewardDiscount: 1,
                paymentId: 1,
                razorpayOrderId: 1,
                showType: 1,
                createdAt: 1,
              },
            },
          ],
          meta: [{ $count: "total" }],
          venues: [{ $group: { _id: "$theater" } }, { $sort: { _id: 1 } }],
          stats: [
            {
              $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                totalTickets: { $sum: "$ticketCount" },
                totalSales: { $sum: "$saleAmount" },
                pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                refunds: { $sum: { $cond: [{ $in: ["$status", ["cancelled", "refunded"]] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]);

    const total = meta[0]?.total || 0;
    const typeSummary = stats[0] || {};

    res.json({
      success: true,
      data,
      filters: {
        statuses: STATUS_OPTIONS,
        theaters: venues.map((item) => item._id).filter(Boolean),
      },
      stats: {
        totalBookings: typeSummary.totalBookings || 0,
        totalTickets: typeSummary.totalTickets || 0,
        totalSales: money(typeSummary.totalSales),
        pending: typeSummary.pending || 0,
        refunds: typeSummary.refunds || 0,
        averageOrderValue: typeSummary.totalBookings
          ? Math.round(money(typeSummary.totalSales) / typeSummary.totalBookings)
          : 0,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("Admin bookings error:", error);
    res.status(500).json({ success: false, message: "Failed to load admin bookings" });
  }
};

export const getAdminOrders = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "10"), 10) || 10, 1), 50);
    const paymentStatus = PAYMENT_STATUS_OPTIONS.includes(req.query.status)
      ? req.query.status
      : "";
    const paymentMethod = PAYMENT_METHOD_OPTIONS.includes(req.query.method)
      ? req.query.method
      : "";
    const bookingStatus = STATUS_OPTIONS.includes(req.query.bookingStatus)
      ? req.query.bookingStatus
      : "";

    const filters = {};
    if (paymentStatus) filters.paymentStatus = paymentStatus;
    if (paymentMethod) filters.paymentMethod = paymentMethod;
    if (bookingStatus) filters.bookingStatus = bookingStatus;

    const [{ data = [], meta = [], stats = [], methods = [] } = {}] = await Payment.aggregate([
      ...ordersBasePipeline(),
      { $match: filters },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                orderId: 1,
                paymentId: 1,
                bookingId: 1,
                userName: 1,
                userEmail: 1,
                bookingStatus: 1,
                totalAmount: 1,
                paymentStatus: 1,
                paymentMethod: 1,
                ticketCount: 1,
                createdDate: 1,
                bookingType: 1,
                bookingTitle: 1,
                bookingVenue: 1,
                bookingDate: 1,
                bookingSlot: 1,
                seatIds: 1,
                coupon: 1,
                couponDiscount: 1,
                rewardPointsRedeemed: 1,
                rewardDiscount: 1,
                refundId: 1,
                currency: 1,
              },
            },
          ],
          meta: [{ $count: "total" }],
          methods: [{ $group: { _id: "$paymentMethod" } }, { $sort: { _id: 1 } }],
          stats: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalRevenue: {
                  $sum: {
                    $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
                  },
                },
                failedOrders: {
                  $sum: { $cond: [{ $eq: ["$paymentStatus", "failed"] }, 1, 0] },
                },
                refundInitiatedOrders: {
                  $sum: { $cond: [{ $eq: ["$paymentStatus", "refund_initiated"] }, 1, 0] },
                },
                refundedOrders: {
                  $sum: { $cond: [{ $eq: ["$paymentStatus", "refunded"] }, 1, 0] },
                },
                ticketsSold: { $sum: "$ticketCount" },
              },
            },
          ],
        },
      },
    ]);

    const total = meta[0]?.total || 0;
    const summary = stats[0] || {};

    res.json({
      success: true,
      data,
      filters: {
        statuses: PAYMENT_STATUS_OPTIONS,
        methods: methods.map((item) => item._id).filter(Boolean),
      },
      stats: {
        totalOrders: summary.totalOrders || 0,
        totalRevenue: money(summary.totalRevenue),
        failedOrders: summary.failedOrders || 0,
        refundedOrders: summary.refundedOrders || 0,
        ticketsSold: summary.ticketsSold || 0,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("Admin orders error:", error);
    res.status(500).json({ success: false, message: "Failed to load admin orders" });
  }
};

export const getAdminUsers = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const page = Math.max(Number.parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "10"), 10) || 10, 1), 50);
    const role = ["user", "admin"].includes(req.query.role) ? req.query.role : "";
    const membership = ["free", "pro"].includes(req.query.membership) ? req.query.membership : "";
    const search = String(req.query.search || "").trim();

    const filters = {};
    if (role) filters.role = role;
    if (membership) filters.membership = membership;
    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const [{ data = [], meta = [], stats = [] } = {}] = await User.aggregate([
      { $match: filters },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                name: 1,
                email: 1,
                phone: 1,
                avatar: 1,
                role: 1,
                membership: 1,
                walletBalance: 1,
                preferences: 1,
                rewardPoints: 1,
                lastLogin: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          meta: [{ $count: "total" }],
          stats: [
            {
              $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                admins: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } },
                proMembers: { $sum: { $cond: [{ $eq: ["$membership", "pro"] }, 1, 0] } },
                walletBalance: { $sum: { $ifNull: ["$walletBalance", 0] } },
              },
            },
          ],
        },
      },
    ]);

    const total = meta[0]?.total || 0;
    const summary = stats[0] || {};

    res.json({
      success: true,
      data,
      filters: {
        roles: ["user", "admin"],
        memberships: ["free", "pro"],
      },
      stats: {
        totalUsers: summary.totalUsers || 0,
        admins: summary.admins || 0,
        proMembers: summary.proMembers || 0,
        walletBalance: money(summary.walletBalance),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);
    res.status(500).json({ success: false, message: "Failed to load admin users" });
  }
};

export const refundAdminOrder = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (payment.status === "refunded") {
      return res.status(400).json({ success: false, message: "Order already refunded" });
    }

    const refundAmount = Number(Number(payment.amount || 0).toFixed(2));
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid refund amount" });
    }

    const booking =
      (await Booking.findById(payment.bookingId).select("userId")) ||
      (await SportBooking.findById(payment.bookingId).select("userId"));

    if (!booking?.userId) {
      return res.status(404).json({ success: false, message: "Booking user not found" });
    }

    const isWalletPayment = payment.method === "wallet" || payment.signature === "wallet";
    const refund = isWalletPayment
      ? { id: `wallet_refund_${payment._id}_${Date.now()}` }
      : await razorpay.payments.refund(payment.paymentId, {
          amount: Math.round(refundAmount * 100),
        });

    const session = await Payment.db.startSession();
    let walletBalance = 0;
    let notificationPayload = null;

    try {
      await session.withTransaction(async () => {
        const lockedPayment = await Payment.findOne({
          _id: payment._id,
          status: { $ne: "refunded" },
        }).session(session);

        if (!lockedPayment) {
          throw new Error("Order already refunded");
        }

        const user = await User.findByIdAndUpdate(
          booking.userId,
          { $inc: { walletBalance: refundAmount } },
          { new: true, session }
        ).select("walletBalance");

        if (!user) {
          throw new Error("User not found");
        }

        walletBalance = Number(user.walletBalance.toFixed(2));
        const balanceBefore = Number((walletBalance - refundAmount).toFixed(2));

        await WalletTransaction.create(
          [
            {
              user: booking.userId,
              type: "credit",
              source: "refund",
              amount: refundAmount,
              balanceBefore,
              balanceAfter: walletBalance,
              status: "success",
              note: `Refund credited for booking (${payment.bookingId})`,
              booking: payment.bookingId,
              payment: payment._id,
            },
          ],
          { session }
        );

        const message = `₹${refundAmount.toFixed(2)} credited to wallet`;
        const dedupeKey = `refund:${payment._id}`;
        let notification = await Notification.findOne({
          user: booking.userId,
          dedupeKey,
        }).session(session);

        if (!notification) {
          const createdNotifications = await Notification.create(
            [
              {
                user: booking.userId,
                type: "wallet_refund",
                title: "Refund successful",
                message,
                amount: refundAmount,
                metadata: {
                  bookingId: String(payment.bookingId),
                  paymentId: String(payment._id),
                  refundId: refund.id,
                },
                dedupeKey,
              },
            ],
            { session }
          );
          notification = createdNotifications[0];
        }

        notificationPayload = {
          id: String(notification._id),
          type: notification.type,
          title: notification.title,
          message: notification.message,
          amount: notification.amount,
          metadata: notification.metadata || {},
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        };

        lockedPayment.refundId = refund.id;
        lockedPayment.status = "refunded";
        await lockedPayment.save({ session });
      });
    } finally {
      session.endSession();
    }

    if (notificationPayload) {
      emitUserNotification(booking.userId, notificationPayload);
    }

    res.json({
      success: true,
      message: "Order marked as refunded and credited to wallet",
      walletBalance,
    });
  } catch (error) {
    console.error("Admin refund error:", error);
    const status = error.message === "Order already refunded" ? 400 : 500;
    res.status(status).json({ success: false, message: error.message || "Failed to refund order" });
  }
};
