import User from "../../user/model/User.js";
import Booking from "../../movies/models/Booking.js";
import SportBooking from "../../sports/models/Booking.js";
import TrainBooking from "../../trains/models/TrainBooking.js";

/**
 * Customer segments.
 *
 * Splits the customer base by what people actually did, not what they are:
 * who never booked, who is active, who has drifted away, and who spends most.
 * It sits beside Coupons on purpose — the point of knowing a segment is being
 * able to send it an offer.
 */

/** A booking only counts once it was actually paid for. */
const PAID_STATUSES = ["paid", "confirmed"];

const ACTIVE_WINDOW_DAYS = 30;
const LAPSED_AFTER_DAYS = 60;
const VIP_COUNT = 10;

export const SEGMENTS = ["new", "active", "lapsed", "vip"];

const SEGMENT_LABELS = {
  new: "Never booked",
  active: `Active (last ${ACTIVE_WINDOW_DAYS} days)`,
  lapsed: `Lapsed (${LAPSED_AFTER_DAYS}+ days quiet)`,
  vip: "Top spenders",
};

const requireAdmin = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "Access denied. Admin role required." });
    return false;
  }
  return true;
};

/** Per-user totals for one booking collection. */
const spendPipeline = [
  { $match: { status: { $in: PAID_STATUSES } } },
  {
    $addFields: {
      userKey: { $toString: "$userId" },
      paidAmount: { $ifNull: ["$amount", { $ifNull: ["$totalPrice", 0] }] },
    },
  },
  {
    $group: {
      _id: "$userKey",
      bookings: { $sum: 1 },
      spend: { $sum: "$paidAmount" },
      lastBookingAt: { $max: "$createdAt" },
    },
  },
];

export const getCustomerSegments = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const requested = SEGMENTS.includes(req.query.segment) ? req.query.segment : "active";

    const [movieSpend, sportSpend, trainSpend, users] = await Promise.all([
      Booking.aggregate(spendPipeline),
      SportBooking.aggregate(spendPipeline),
      TrainBooking.aggregate(spendPipeline),
      User.find({ role: { $ne: "admin" } })
        .select("_id name email phone membership createdAt")
        .lean(),
    ]);

    // Fold the three collections into one per-user total.
    const totals = new Map();
    for (const row of [...movieSpend, ...sportSpend, ...trainSpend]) {
      if (!row._id) continue;
      const current = totals.get(row._id) || { bookings: 0, spend: 0, lastBookingAt: null };
      current.bookings += row.bookings || 0;
      current.spend += row.spend || 0;
      if (row.lastBookingAt && (!current.lastBookingAt || row.lastBookingAt > current.lastBookingAt)) {
        current.lastBookingAt = row.lastBookingAt;
      }
      totals.set(row._id, current);
    }

    const now = Date.now();
    const activeCutoff = now - ACTIVE_WINDOW_DAYS * 86400000;
    const lapsedCutoff = now - LAPSED_AFTER_DAYS * 86400000;

    const enriched = users.map((user) => {
      const stats = totals.get(String(user._id)) || { bookings: 0, spend: 0, lastBookingAt: null };
      const lastAt = stats.lastBookingAt ? new Date(stats.lastBookingAt).getTime() : null;

      let segment;
      if (stats.bookings === 0) segment = "new";
      else if (lastAt && lastAt >= activeCutoff) segment = "active";
      else if (lastAt && lastAt <= lapsedCutoff) segment = "lapsed";
      else segment = "active"; // between the two windows — still counts as engaged

      return {
        _id: String(user._id),
        name: user.name || "Unnamed",
        email: user.email || "",
        phone: user.phone || "",
        membership: user.membership || "free",
        joinedAt: user.createdAt || null,
        bookings: stats.bookings,
        spend: Math.round(stats.spend),
        lastBookingAt: stats.lastBookingAt,
        segment,
      };
    });

    // VIP is a ranking, not a bucket, so it overlays the others.
    const vipIds = new Set(
      [...enriched]
        .filter((row) => row.spend > 0)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, VIP_COUNT)
        .map((row) => row._id)
    );
    enriched.forEach((row) => {
      row.isVip = vipIds.has(row._id);
    });

    const inSegment = (row, segment) => (segment === "vip" ? row.isVip : row.segment === segment);

    const counts = SEGMENTS.reduce((acc, segment) => {
      const rows = enriched.filter((row) => inSegment(row, segment));
      acc[segment] = {
        label: SEGMENT_LABELS[segment],
        count: rows.length,
        value: Math.round(rows.reduce((sum, row) => sum + row.spend, 0)),
      };
      return acc;
    }, {});

    const data = enriched
      .filter((row) => inSegment(row, requested))
      .sort((a, b) =>
        requested === "new"
          ? new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0)
          : b.spend - a.spend
      );

    return res.json({
      success: true,
      segment: requested,
      data,
      segments: counts,
      windows: { activeDays: ACTIVE_WINDOW_DAYS, lapsedDays: LAPSED_AFTER_DAYS, vipCount: VIP_COUNT },
    });
  } catch (error) {
    console.error("getCustomerSegments error:", error);
    return res.status(500).json({ message: "Failed to load customer segments" });
  }
};
