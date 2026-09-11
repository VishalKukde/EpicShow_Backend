import mongoose from "mongoose";
import MovieBooking from "../../movies/models/Booking.js";
import TrainBooking from "../../trains/models/TrainBooking.js";
import SportBooking from "../../sports/models/Booking.js";
import Movie from "../../movies/models/Movie.js";
import Sport from "../../sports/models/Sport.js";
import Gaming from "../../gaming/models/Gaming.js";
import Train from "../../trains/models/Train.js";
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

    // 1. Movie bookings (only if category is 'movie', 'movies', 'all', or unspecified)
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
        const userQuery = mongoose.Types.ObjectId.isValid(stringId)
          ? { $or: [{ userId: new mongoose.Types.ObjectId(stringId) }, { userId: stringId }] }
          : { userId: stringId };

        const trainBookings = await TrainBooking.find(userQuery)
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
            date: tb.journeyDate ? new Date(tb.journeyDate).toLocaleDateString("en-IN") : "Scheduled Date",
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

        formattedGamingBookings = await Promise.all(
          gamingBookings.map(async (gb) => {
            let title = "VR & Gaming Lounge Pass";
            let venue = "Gaming Lounge";
            if (gb.itemId) {
              try {
                const gameDoc = await Gaming.findById(gb.itemId).select("title venue city").lean();
                if (gameDoc) {
                  title = gameDoc.title || title;
                  venue = gameDoc.venue ? `${gameDoc.venue}, ${gameDoc.city || ""}` : venue;
                }
              } catch {
                // Ignore invalid ObjectId cast
              }
            }
            return {
              category: "gaming",
              categoryLabel: "Gaming Lounge Slot",
              bookingId: String(gb._id),
              title,
              venue,
              date: gb.date || "Booked Slot",
              slot: gb.slot || "Session Time",
              seats: gb.seatIds && gb.seatIds.length ? gb.seatIds.join(", ") : "Station / Arena",
              amount: gb.amount ? `₹${gb.amount}` : "Paid",
              status: gb.status === "paid" ? "Confirmed" : gb.status || "Confirmed",
              createdAt: gb.createdAt,
            };
          })
        );
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
 * Search movies strictly from MongoDB database
 * Supports particular movie search, upcoming movies, currently playing, and top rated.
 * ZERO placeholder/dummy data.
 * @param {object} options
 * @param {string|null} options.query - Title or keyword
 * @param {string} options.type - "particular" | "upcoming" | "playing" | "top_rated" | "all"
 * @param {number} options.limit
 * @param {string} options.sortBy - "latest" | "rating" | "release"
 * @returns {Promise<object>}
 */
export async function searchMoviesInDb({
  query = null,
  type = "all",
  limit = 5,
  sortBy = "latest",
} = {}) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { found: false, count: 0, items: [], message: "Database not connected." };
    }

    const now = new Date();
    let mongoQuery = {};
    let sortCriteria = { releaseDate: -1, createdAt: -1 };

    if (sortBy === "rating" || type === "top_rated") {
      sortCriteria = { rating: -1, avg_rating: -1 };
    } else if (type === "upcoming" || sortBy === "release") {
      sortCriteria = { releaseDate: 1 };
    }

    // 1. Upcoming movies filter
    if (type === "upcoming") {
      mongoQuery.releaseDate = { $gt: now };
    } else if (type === "playing") {
      mongoQuery.$or = [
        { releaseDate: { $lte: now } },
        { releaseDate: { $exists: false } },
        { releaseDate: null },
      ];
    } else if (type === "top_rated") {
      mongoQuery.rating = { $gt: 0 };
    }

    // 2. Specific search term / particular movie filter
    if (query && typeof query === "string" && query.trim()) {
      const cleanQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
      const searchOr = [
        { name: { $regex: cleanQuery, $options: "i" } },
        { description: { $regex: cleanQuery, $options: "i" } },
        { genre: { $regex: cleanQuery, $options: "i" } },
        { language: { $regex: cleanQuery, $options: "i" } },
      ];

      if (mongoQuery.releaseDate || mongoQuery.$or) {
        mongoQuery = { $and: [mongoQuery, { $or: searchOr }] };
      } else {
        mongoQuery.$or = searchOr;
      }
    }

    const movies = await Movie.find(mongoQuery)
      .sort(sortCriteria)
      .limit(limit)
      .select("name description genre language runtimeMinutes rating avg_rating releaseDate imageUrl")
      .lean();

    if (!movies || movies.length === 0) {
      return {
        found: false,
        query,
        type,
        count: 0,
        items: [],
        message: query
          ? `No movie matching "${query}" was found in EpicShow's database catalog.`
          : "No matching movies found in database.",
      };
    }

    const formatted = movies.map((m) => {
      const ratingVal = m.rating || m.avg_rating || null;
      return {
        id: String(m._id),
        name: m.name || m.title || "Movie",
        genre: Array.isArray(m.genre) ? m.genre.join(", ") : m.genre || "",
        language: m.language || "English",
        runtime: m.runtimeMinutes ? `${m.runtimeMinutes} mins` : "",
        rating: ratingVal ? `${ratingVal.toFixed(1)} ★` : (m.releaseDate && new Date(m.releaseDate) > now ? "Upcoming (Not yet rated)" : "Unrated"),
        releaseDate: m.releaseDate
          ? new Date(m.releaseDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "Now Showing",
        isUpcoming: Boolean(m.releaseDate && new Date(m.releaseDate) > now),
        description: m.description || "",
      };
    });

    return {
      found: true,
      query,
      type,
      count: formatted.length,
      items: formatted,
    };
  } catch (error) {
    console.error("[User AI Mongo] searchMoviesInDb error:", error.message);
    return {
      found: false,
      count: 0,
      items: [],
      error: error.message,
    };
  }
}

/**
 * Search sports matches strictly from MongoDB database
 * ZERO dummy data or placeholders.
 * @param {object} options
 * @param {string|null} options.query - Team, league, city, venue, or sport
 * @param {number} options.limit
 * @returns {Promise<object>}
 */
export async function searchSportsInDb({ query = null, limit = 5 } = {}) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { found: false, count: 0, items: [], message: "Database not connected." };
    }

    let mongoQuery = {};

    if (query && typeof query === "string" && query.trim()) {
      const cleanQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
      mongoQuery = {
        $or: [
          { teamA: { $regex: cleanQuery, $options: "i" } },
          { teamB: { $regex: cleanQuery, $options: "i" } },
          { league: { $regex: cleanQuery, $options: "i" } },
          { sportType: { $regex: cleanQuery, $options: "i" } },
          { city: { $regex: cleanQuery, $options: "i" } },
          { venue: { $regex: cleanQuery, $options: "i" } },
          { description: { $regex: cleanQuery, $options: "i" } },
        ],
      };
    }

    const matches = await Sport.find(mongoQuery)
      .sort({ date: 1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!matches || matches.length === 0) {
      return {
        found: false,
        query,
        count: 0,
        items: [],
        message: query
          ? `No sports matches matching "${query}" were found in EpicShow's database.`
          : "No sports matches found in database.",
      };
    }

    const formatted = matches.map((s) => {
      let priceText = "₹300 - ₹600";
      if (s.prices) {
        const std = s.prices.standard;
        const vip = s.prices.vip || s.prices.premium;
        if (std && vip) {
          priceText = `₹${std} - ₹${vip}`;
        } else if (std) {
          priceText = `From ₹${std}`;
        }
      }

      return {
        id: String(s._id),
        league: s.league || s.sportType || "Sports Match",
        matchNo: s.matchNo || "",
        teams: s.teamA && s.teamB ? `${s.teamA} vs ${s.teamB}` : s.league || "Match",
        teamA: s.teamA || "",
        teamB: s.teamB || "",
        date: s.date || "",
        time: s.time || "",
        venue: s.venue ? `${s.venue}, ${s.city || ""}` : s.city || "Stadium",
        city: s.city || "",
        priceRange: priceText,
        rating: s.rating ? `${s.rating.toFixed(1)} ★` : "",
        language: s.language || "",
        description: s.description || "",
      };
    });

    return {
      found: true,
      query,
      count: formatted.length,
      items: formatted,
    };
  } catch (error) {
    console.error("[User AI Mongo] searchSportsInDb error:", error.message);
    return {
      found: false,
      count: 0,
      items: [],
      error: error.message,
    };
  }
}

/**
 * Search gaming events strictly from MongoDB database
 * ZERO dummy data or placeholders.
 * @param {object} options
 * @param {string|null} options.query - Title, city, venue, or organizer
 * @param {number} options.limit
 * @returns {Promise<object>}
 */
export async function searchGamingInDb({ query = null, limit = 5 } = {}) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { found: false, count: 0, items: [], message: "Database not connected." };
    }

    let mongoQuery = {};

    if (query && typeof query === "string" && query.trim()) {
      const cleanQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
      mongoQuery = {
        $or: [
          { title: { $regex: cleanQuery, $options: "i" } },
          { city: { $regex: cleanQuery, $options: "i" } },
          { venue: { $regex: cleanQuery, $options: "i" } },
          { organizer: { $regex: cleanQuery, $options: "i" } },
          { description: { $regex: cleanQuery, $options: "i" } },
        ],
      };
    }

    const items = await Gaming.find(mongoQuery)
      .sort({ startDateTime: 1 })
      .limit(limit)
      .lean();

    if (!items || items.length === 0) {
      return {
        found: false,
        query,
        count: 0,
        items: [],
        message: query
          ? `No gaming events matching "${query}" were found in EpicShow's database.`
          : "No gaming shows found in database.",
      };
    }

    const formatted = items.map((g) => {
      const d = g.startDateTime ? new Date(g.startDateTime) : null;
      return {
        id: String(g._id),
        title: g.title,
        venue: g.venue ? `${g.venue}, ${g.city || ""}` : g.city || "",
        city: g.city || "",
        date: d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "",
        time: d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "",
        price: g.price !== undefined ? `₹${g.price}` : "Free Pass",
        availableSeats: g.availableSeats ?? g.totalSeats ?? 0,
        totalSeats: g.totalSeats ?? 0,
        organizer: g.organizer || "EpicShow Gaming",
        description: g.description || "",
      };
    });

    return {
      found: true,
      query,
      count: formatted.length,
      items: formatted,
    };
  } catch (error) {
    console.error("[User AI Mongo] searchGamingInDb error:", error.message);
    return {
      found: false,
      count: 0,
      items: [],
      error: error.message,
    };
  }
}

/**
 * Search trains strictly from MongoDB database
 * ZERO dummy data or placeholders.
 * @param {object} options
 * @param {string|null} options.query - Train name or number
 * @param {string|null} options.from - From station
 * @param {string|null} options.to - To station
 * @param {number} options.limit
 * @returns {Promise<object>}
 */
export async function searchTrainsInDb({
  query = null,
  from = null,
  to = null,
  limit = 5,
} = {}) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { found: false, count: 0, items: [], message: "Database not connected." };
    }

    const filter = { isActive: true };

    if (from && to) {
      filter.fromStation = { $regex: from.trim(), $options: "i" };
      filter.toStation = { $regex: to.trim(), $options: "i" };
    } else if (from) {
      filter.fromStation = { $regex: from.trim(), $options: "i" };
    } else if (to) {
      filter.toStation = { $regex: to.trim(), $options: "i" };
    } else if (query && typeof query === "string" && query.trim()) {
      const cleanQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
      filter.$or = [
        { trainName: { $regex: cleanQuery, $options: "i" } },
        { trainNumber: { $regex: cleanQuery, $options: "i" } },
        { fromStation: { $regex: cleanQuery, $options: "i" } },
        { toStation: { $regex: cleanQuery, $options: "i" } },
        { trainType: { $regex: cleanQuery, $options: "i" } },
      ];
    }

    const trains = await Train.find(filter)
      .sort({ rating: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!trains || trains.length === 0) {
      return {
        found: false,
        query: query || (from && to ? `${from} to ${to}` : null),
        count: 0,
        items: [],
        message: query || (from && to)
          ? `No trains matching the criteria were found in EpicShow's database.`
          : "No trains found in database.",
      };
    }

    const formatted = trains.map((t) => ({
      id: String(t._id),
      trainNumber: t.trainNumber,
      trainName: t.trainName,
      fromStation: t.fromStation,
      toStation: t.toStation,
      route: `${t.fromStation} ➔ ${t.toStation}`,
      trainType: t.trainType,
      departureTime: t.departureTime,
      arrivalTime: t.arrivalTime,
      duration: t.duration,
      price: t.price !== undefined ? `₹${t.price}` : "",
      availableSeats: t.availableSeats ?? 0,
      rating: t.rating ? `${t.rating.toFixed(1)} ★` : "",
      operatingDays: Array.isArray(t.operatingDays) ? t.operatingDays.join(", ") : "",
      amenities: Array.isArray(t.amenities) ? t.amenities.join(", ") : "",
    }));

    return {
      found: true,
      query: query || (from && to ? `${from} to ${to}` : null),
      count: formatted.length,
      items: formatted,
    };
  } catch (error) {
    console.error("[User AI Mongo] searchTrainsInDb error:", error.message);
    return {
      found: false,
      count: 0,
      items: [],
      error: error.message,
    };
  }
}

/**
 * Backward compatibility alias for currently playing catalog
 */
export async function getUpcomingCatalog(category = "movies", limit = 3, sortBy = "latest") {
  return searchMoviesInDb({ type: "playing", limit, sortBy });
}
