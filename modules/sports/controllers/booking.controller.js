import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import { parseShowDateTime } from "../../../utils/Helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.join(__dirname, "../data/sports.json");

const resolveSchedule = (booking) => {
  const date = booking?.schedule?.date || booking?.date || null;
  const time = booking?.schedule?.time || booking?.slot || null;
  return { date, time };
};

const loadSportsData = async () => {
  const raw = await fs.readFile(dataPath, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
};

const buildVenueLabel = (booking) => {
  const name = booking?.venue?.name || "";
  const city = booking?.venue?.city || "";
  if (name && city) return `${name}, ${city}`;
  return name || city || "Stadium";
};

const buildShowName = (booking, match) => {
  if (booking?.teams?.label) return booking.teams.label;
  if (booking?.teams?.teamA && booking?.teams?.teamB) {
    return `${booking.teams.teamA} vs ${booking.teams.teamB}`;
  }
  if (match?.teamA && match?.teamB) {
    return `${match.teamA} vs ${match.teamB}`;
  }
  if (booking?.league) {
    return `${booking.league}${booking.matchNo ? ` • ${booking.matchNo}` : ""}`;
  }
  return "Sport match";
};

const toBookingView = (booking, match) => {
  const { date, time } = resolveSchedule(booking);
  return {
    ...booking,
    itemId: booking.matchId,
    cinemaId: buildVenueLabel(booking),
    date: date || "",
    slot: time || "",
    showType: "sport",
    show: {
      name: buildShowName(booking, match),
      imageUrl: match?.imageUrl || "/dummy.webp",
    },
  };
};

export const getSportBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const { date, time } = resolveSchedule(booking);
    if (date && time) {
      const showDateTime = parseShowDateTime(date, time);
      const now = new Date();
      const EXPIRE_ELIGIBLE = ["pending", "paid"];

      if (showDateTime < now && EXPIRE_ELIGIBLE.includes(booking.status)) {
        booking.status = "expired";
        await booking.save();
      }
    }

    const payment = await Payment.findOne({
      bookingId: booking._id,
    });

    const sportsData = await loadSportsData();
    const match = sportsData.find((item) => item && item._id === booking.matchId);
    const bookingView = toBookingView(booking.toObject(), match);

    res.json({
      booking: bookingView,
      payment,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch booking" });
  }
};

export const getSportBookings = async (req, res) => {
  try {
    const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "0"), 10);

    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1
      ? 0
      : Math.min(parsedLimit, 50);
    const usePagination = limit > 0;
    const skip = usePagination ? (page - 1) * limit : 0;

    const totalCount = await Booking.countDocuments({ userId: req.user.id });
    const bookings = await Booking.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(usePagination ? limit : 0);

    const sportsData = await loadSportsData();

    const data = await Promise.all(
      bookings.map(async (booking) => {
        const match = sportsData.find((item) => item && item._id === booking.matchId);
        const { date, time } = resolveSchedule(booking);

        if (date && time) {
          const showDateTime = parseShowDateTime(date, time);
          const now = new Date();
          const EXPIRE_ELIGIBLE = ["pending", "paid"];

          if (showDateTime < now && EXPIRE_ELIGIBLE.includes(booking.status)) {
            booking.status = "expired";
            await booking.save();
          }
        }

        return toBookingView(booking.toObject(), match);
      })
    );

    res.status(200).json({
      success: true,
      count: data.length,
      totalCount,
      data,
      pagination: {
        page,
        limit: usePagination ? limit : totalCount,
        total: totalCount,
        hasMore: usePagination ? skip + data.length < totalCount : false,
      },
    });
  } catch (err) {
    console.error("Error fetching sports bookings:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sports bookings",
    });
  }
};
