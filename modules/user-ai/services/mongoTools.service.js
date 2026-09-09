import mongoose from "mongoose";
import MovieBooking from "../../movies/models/Booking.js";
import TrainBooking from "../../trains/models/TrainBooking.js";
import SportBooking from "../../sports/models/Booking.js";
import Movie from "../../movies/models/Movie.js";
import Payment from "../../movies/models/Payment.js";
import UserCoupon from "../../offers/model/UserCoupon.js";
import User from "../../user/model/User.js";

/**
 * Retrieve recent bookings strictly scoped to the authenticated user ID
 * @param {string|object} userId
 * @param {string|null} category - "movie" | "train" | "sports" | "gaming" | null
 * @param {number} limit
 * @returns {Promise<object>}
 */
export async function getUserBookings(userId, category = null, limit = 5) {
  if (!userId) {
    return {
      authenticated: false,
      message: "User is not logged in. Tell the user to log in to view their bookings.",
    };
  }

  try {
    const stringId = String(userId);
    if (mongoose.connection.readyState !== 1) {
      return { authenticated: true, count: 0, bookings: [] };
    }
    const catLower = category ? category.toLowerCase().trim() : null;

    let enrichedMovieBookings = [];
    let formattedTrainBookings = [];
    let formattedSportBookings = [];
    let formattedGamingBookings = [];

    // 1. Movie bookings (only if category is 'movie', 'all', or unspecified)
    if (!catLower || catLower === "movie" || catLower === "movies" || catLower === "all") {
      const movieQuery = {
        userId: stringId,
        $or: [{ showType: "movie" }, { showType: { $ne: "gaming" } }, { showType: { $exists: false } }],
      };

      const movieBookings = await MovieBooking.find(movieQuery)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      enrichedMovieBookings = await Promise.all(
        movieBookings.map(async (b) => {
          let title = "Movie Ticket";
          let details = "";
          if (b.itemId) {
            try {
              const movieDoc = await Movie.findById(b.itemId).select("name title genre language").lean();
              if (movieDoc) {
                title = movieDoc.name || movieDoc.title || title;
                details = `${Array.isArray(movieDoc.genre) ? movieDoc.genre.join(", ") : movieDoc.genre || ""} (${movieDoc.language || "EN"})`;
              }
            } catch {
              // Ignore invalid ObjectId cast
            }
          }
          return {
            category: "movie",
            categoryLabel: "Movie Ticket",
            bookingId: String(b._id),
            title,
            details,
            date: b.date || "Scheduled Date",
            slot: b.slot || "Showtime",
            seats: b.seatIds && b.seatIds.length ? b.seatIds.join(", ") : "General Admission",
            seatCount: Array.isArray(b.seatIds) ? b.seatIds.length : 1,
            amount: b.amount ? `₹${b.amount}` : "Paid",
            status: b.status === "paid" ? "Confirmed" : b.status || "Confirmed",
            createdAt: b.createdAt,
          };
        })
      );
    }

    // 2. Train bookings
    if (!catLower || catLower === "train" || catLower === "trains" || catLower === "all") {
      try {
        const trainBookings = await TrainBooking.find({
          userId,
        })
          .populate("trainId", "trainName trainNumber fromStation toStation")
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        formattedTrainBookings = trainBookings.map((tb) => {
          const train = tb.trainId || {};
          return {
            category: "train",
            categoryLabel: "Train Ticket",
            bookingId: String(tb._id),
            pnr: tb.pnr || "N/A",
            title: train.trainName ? `${train.trainName} #${train.trainNumber || ""}` : "Train Journey",
            route: train.fromStation && train.toStation ? `${train.fromStation} ➔ ${train.toStation}` : "Express Route",
            date: tb.journeyDate || "Scheduled Date",
            seats: tb.seats && tb.seats.length ? tb.seats.join(", ") : "Allocated Berth",
            amount: tb.totalPrice ? `₹${tb.totalPrice}` : "Paid",
            status: tb.status === "confirmed" || tb.status === "paid" ? "Confirmed" : tb.status || "Confirmed",
            createdAt: tb.createdAt,
          };
        });
      } catch (trainErr) {
        console.warn("[User AI Mongo] Error querying train bookings:", trainErr.message);
      }
    }

    // 3. Sports bookings
    if (!catLower || catLower === "sport" || catLower === "sports" || catLower === "all") {
      try {
        const sportBookings = await SportBooking.find({
          userId: stringId,
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        formattedSportBookings = sportBookings.map((sb) => ({
          category: "sports",
          categoryLabel: "Sports Match Ticket",
          bookingId: String(sb._id),
          title: sb.teams ? `${sb.teams.teamA} vs ${sb.teams.teamB}` : sb.league || "Sports Match",
          venue: sb.venue ? `${sb.venue.name || ""}, ${sb.venue.city || ""}` : "Stadium",
          date: sb.schedule?.date || "Match Day",
          slot: sb.schedule?.time || "Match Time",
          seats: sb.seatIds && sb.seatIds.length ? sb.seatIds.join(", ") : "General Stand",
          amount: sb.amount ? `₹${sb.amount}` : "Paid",
          status: sb.status === "paid" ? "Confirmed" : sb.status || "Confirmed",
          createdAt: sb.createdAt,
        }));
      } catch (sportErr) {
        console.warn("[User AI Mongo] Error querying sport bookings:", sportErr.message);
      }
    }

    // 4. Gaming bookings
    if (!catLower || catLower === "gaming" || catLower === "game" || catLower === "all") {
      try {
        const gamingBookings = await MovieBooking.find({
          userId: stringId,
          showType: "gaming",
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        formattedGamingBookings = gamingBookings.map((gb) => ({
          category: "gaming",
          categoryLabel: "Gaming Lounge Slot",
          bookingId: String(gb._id),
          title: "VR & Gaming Lounge Pass",
          date: gb.date || "Booked Slot",
          slot: gb.slot || "Session Time",
          seats: gb.seatIds && gb.seatIds.length ? gb.seatIds.join(", ") : "Rig / Console Station",
          amount: gb.amount ? `₹${gb.amount}` : "Paid",
          status: gb.status === "paid" ? "Confirmed" : gb.status || "Confirmed",
          createdAt: gb.createdAt,
        }));
      } catch (gamingErr) {
        console.warn("[User AI Mongo] Error querying gaming bookings:", gamingErr.message);
      }
    }

    const combined = [
      ...enrichedMovieBookings,
      ...formattedTrainBookings,
      ...formattedSportBookings,
      ...formattedGamingBookings,
    ]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, limit);

    return {
      authenticated: true,
      requestedCategory: catLower || "all",
      count: combined.length,
      bookings: combined,
    };
  } catch (error) {
    console.error("[User AI Mongo] getUserBookings error:", error.message);
    return {
      authenticated: true,
      error: "Could not retrieve bookings right now.",
      bookings: [],
    };
  }
}

/**
 * Retrieve user's refund status for cancelled bookings
 * @param {string|object} userId
 * @returns {Promise<object>}
 */
export async function getUserRefundStatus(userId) {
  if (!userId) {
    return {
      authenticated: false,
      message: "User is not logged in. Tell the user to log in to view their refund status.",
    };
  }

  try {
    const stringId = String(userId);

    const refundPayments = await Payment.find({
      userId: stringId,
      status: { $in: ["refunded", "refund_initiated"] },
    })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();

    const refunds = refundPayments.map((p) => ({
      paymentId: p.paymentId,
      title: p.title || "Booking Refund",
      details: p.details,
      amount: p.amount ? `₹${p.amount}` : "N/A",
      status: p.status === "refunded" ? "Completed / Credited" : "In Progress (1-3 business days)",
      refundId: p.refundId || undefined,
      date: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("en-IN") : "Recent",
    }));

    return {
      authenticated: true,
      count: refunds.length,
      refunds,
    };
  } catch (error) {
    console.error("[User AI Mongo] getUserRefundStatus error:", error.message);
    return {
      authenticated: true,
      error: "Could not retrieve refund status right now.",
      refunds: [],
    };
  }
}

/**
 * Retrieve active coupons collected by the authenticated user
 * @param {string|object} userId
 * @returns {Promise<object>}
 */
export async function getUserCoupons(userId) {
  if (!userId) {
    return {
      authenticated: false,
      message: "User is not logged in. Tell the user to log in to view their active coupons.",
    };
  }

  try {
    const stringId = String(userId);
    const userCoupons = await UserCoupon.find({
      userId: stringId,
      status: "ACTIVE",
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const coupons = userCoupons.map((c) => ({
      code: c.code,
      status: c.status,
      collectedAt: c.collectedAt ? new Date(c.collectedAt).toLocaleDateString("en-IN") : "Active",
    }));

    return {
      authenticated: true,
      count: coupons.length,
      coupons,
    };
  } catch (error) {
    console.error("[User AI Mongo] getUserCoupons error:", error.message);
    return {
      authenticated: true,
      error: "Could not retrieve coupons right now.",
      coupons: [],
    };
  }
}

/**
 * Retrieve user profile and live wallet balance directly from the database
 * @param {string|object} userId
 * @returns {Promise<object>}
 */
export async function getUserProfileAndWallet(userId) {
  if (!userId) {
    return {
      authenticated: false,
      message: "User is not logged in. Tell the user to log in to view their wallet balance and profile details.",
    };
  }

  try {
    const stringId = String(userId);
    if (mongoose.connection.readyState !== 1) {
      return {
        authenticated: true,
        walletBalance: 0,
        formattedWalletBalance: "₹0",
        rewardPoints: 0,
      };
    }

    const userDoc = await User.findById(stringId)
      .select("name email phone role membership walletBalance rewardPoints status createdAt")
      .lean();

    if (!userDoc) {
      return {
        authenticated: false,
        message: "User account not found in database.",
      };
    }

    return {
      authenticated: true,
      name: userDoc.name,
      email: userDoc.email,
      phone: userDoc.phone || "Not set",
      role: userDoc.role || "user",
      membership: userDoc.membership === "pro" ? "EpicShow Pro" : "Free Member",
      walletBalance: userDoc.walletBalance ?? 0,
      formattedWalletBalance: `₹${userDoc.walletBalance ?? 0}`,
      rewardPoints: userDoc.rewardPoints ?? 0,
      status: userDoc.status || "Active",
    };
  } catch (error) {
    console.error("[User AI Mongo] getUserProfileAndWallet error:", error.message);
    return {
      authenticated: true,
      error: "Could not retrieve wallet balance from database right now.",
    };
  }
}

/**
 * Retrieve currently playing movie listings strictly from MongoDB database
 * @param {string} category
 * @param {number} limit - defaults to 3 movies
 * @param {string} sortBy - "latest" | "rating" | "best"
 * @returns {Promise<object>}
 */
export async function getUpcomingCatalog(category = "movies", limit = 3, sortBy = "latest") {
  try {
    if (mongoose.connection.readyState !== 1) {
      return {
        category: "movies",
        count: 0,
        items: [],
      };
    }

    const sortCriteria =
      sortBy === "rating" || sortBy === "best"
        ? { avg_rating: -1, rating: -1, releaseDate: -1 }
        : { releaseDate: -1, createdAt: -1 };

    const now = new Date();
    // 1. Fetch currently playing movies (releaseDate <= now or unscheduled)
    let movies = await Movie.find({
      $or: [
        { releaseDate: { $lte: now } },
        { releaseDate: { $exists: false } },
        { releaseDate: null },
      ],
    })
      .sort(sortCriteria)
      .limit(limit)
      .select("name description genre language runtimeMinutes rating avg_rating releaseDate imageUrl")
      .lean();

    // 2. If no currently released movies found, fetch latest available movies in DB
    if (!movies || movies.length === 0) {
      movies = await Movie.find()
        .sort(sortCriteria)
        .limit(limit)
        .select("name description genre language runtimeMinutes rating avg_rating releaseDate imageUrl")
        .lean();
    }

    if (movies && movies.length > 0) {
      const formatted = movies.slice(0, limit).map((m) => ({
        id: String(m._id),
        name: m.name || m.title || "Movie",
        genre: Array.isArray(m.genre) ? m.genre.join(", ") : m.genre || "Action, Drama",
        language: m.language || "English",
        runtime: m.runtimeMinutes ? `${m.runtimeMinutes} mins` : "120 mins",
        rating: m.avg_rating || m.rating ? `${(m.avg_rating || m.rating).toFixed(1)} ★` : "8.5 ★",
        releaseDate: m.releaseDate ? new Date(m.releaseDate).toLocaleDateString("en-IN") : "Now Showing",
        description: m.description || "A premier cinematic pick featured on EpicShow.",
      }));

      return {
        category: "movies",
        count: formatted.length,
        items: formatted,
      };
    }

    return {
      category: "movies",
      count: 0,
      items: [],
    };
  } catch (error) {
    console.warn("[User AI Mongo] getUpcomingCatalog query error:", error.message);
    return {
      category: "movies",
      count: 0,
      items: [],
    };
  }
}
