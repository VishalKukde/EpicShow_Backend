import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Movie from "../models/Movie.js";
import Review from "../models/Review.js";
import { parseShowDateTime } from "../../../utils/Helper.js";

const MAX_COMMENT_LENGTH = 1000;
const REVIEWABLE_BOOKING_STATUSES = new Set([
  "paid",
  "expired",
  "booked",
  "BOOKED",
]);

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

const isReviewableBookingStatus = (status) =>
  REVIEWABLE_BOOKING_STATUSES.has(String(status || "").trim());

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const buildMovieRatingUpdatePipeline = (nextRating) => [
  {
    $set: {
      total_reviews: { $add: [{ $ifNull: ["$total_reviews", 0] }, 1] },
      avg_rating: {
        $round: [
          {
            $divide: [
              {
                $add: [
                  {
                    $multiply: [
                      { $ifNull: ["$avg_rating", 0] },
                      { $ifNull: ["$total_reviews", 0] },
                    ],
                  },
                  nextRating,
                ],
              },
              { $add: [{ $ifNull: ["$total_reviews", 0] }, 1] },
            ],
          },
          1,
        ],
      },
    },
  },
];

export const createReview = async (req, res) => {
  try {
    const userId = normalizeString(req.user?.id);
    const bookingId = normalizeString(req.body?.bookingId ?? req.body?.booking_id);
    const movieId = normalizeString(req.body?.movieId ?? req.body?.movie_id);
    const rating = Number(req.body?.rating);
    const comment = normalizeString(req.body?.comment);

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!bookingId || !movieId) {
      return res.status(400).json({ message: "bookingId and movieId are required" });
    }

    if (
      !mongoose.Types.ObjectId.isValid(bookingId) ||
      !mongoose.Types.ObjectId.isValid(movieId)
    ) {
      return res.status(400).json({ message: "Invalid booking or movie id" });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be an integer between 1 and 5" });
    }

    if (comment.length > MAX_COMMENT_LENGTH) {
      return res
        .status(400)
        .json({ message: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` });
    }

    const booking = await Booking.findById(bookingId).lean();

    if (!booking) {
      return res.status(404).json({ message: "Invalid booking ID" });
    }

    if (String(booking.userId) !== userId) {
      return res.status(403).json({ message: "You can review only your own booking" });
    }

    if (String(booking.showType || "").toLowerCase() !== "movie") {
      return res.status(400).json({ message: "Only movie bookings can be reviewed" });
    }

    if (String(booking.itemId) !== movieId) {
      return res
        .status(400)
        .json({ message: "Booking does not belong to the selected movie" });
    }

    if (!isReviewableBookingStatus(booking.status)) {
      return res
        .status(400)
        .json({ message: "Only confirmed bookings can be reviewed" });
    }

    const showTime = parseShowDateTime(booking.date, booking.slot);
    if (!(showTime instanceof Date) || Number.isNaN(showTime.getTime())) {
      return res.status(400).json({ message: "Unable to verify show time for this booking" });
    }

    if (showTime >= new Date()) {
      return res
        .status(400)
        .json({ message: "You can submit a review only after the show time has passed" });
    }

    const existingReview = await Review.findOne({ booking_id: bookingId })
      .select("_id")
      .lean();

    if (existingReview) {
      return res.status(409).json({ message: "Review already submitted for this booking" });
    }

    const movie = await Movie.findById(movieId)
      .select("_id avg_rating total_reviews")
      .lean();

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const review = await Review.create({
      user_id: userId,
      movie_id: movieId,
      booking_id: bookingId,
      rating,
      comment,
    });

    const updatedMovie = await Movie.findOneAndUpdate(
      { _id: movieId },
      buildMovieRatingUpdatePipeline(rating),
      {
        new: true,
        projection: { avg_rating: 1, total_reviews: 1 },
        updatePipeline: true,
      }
    );

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      data: {
        review: {
          _id: review._id,
          user_id: review.user_id,
          movie_id: review.movie_id,
          booking_id: review.booking_id,
          rating: review.rating,
          comment: review.comment,
          created_at: review.created_at,
          verified_booking: true,
        },
        movie: {
          avg_rating: Number(updatedMovie?.avg_rating ?? movie.avg_rating ?? 0),
          total_reviews: Number(updatedMovie?.total_reviews ?? movie.total_reviews ?? 0),
        },
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Review already submitted for this booking" });
    }

    console.error("Failed to create review:", error);
    return res.status(500).json({ message: "Failed to submit review" });
  }
};

export const getMovieReviews = async (req, res) => {
  try {
    const movieId = normalizeString(req.query.movieId ?? req.query.movie_id);

    if (!movieId) {
      return res.status(400).json({ message: "movieId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(movieId)) {
      return res.status(400).json({ message: "Invalid movie id" });
    }

    const page = parsePositiveInteger(req.query.page, 1);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 10), 20);
    const skip = (page - 1) * limit;

    const movie = await Movie.findById(movieId)
      .select("_id avg_rating total_reviews")
      .lean();

    if (!movie) {
      return res.status(404).json({ message: "Movie not found" });
    }

    const [result = {}] = await Review.aggregate([
      {
        $match: { movie_id: movieId },
      },
      {
        $sort: { created_at: -1 },
      },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "users",
                let: { reviewUserId: "$user_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: "$_id" }, "$$reviewUserId"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                    },
                  },
                ],
                as: "user",
              },
            },
            {
              $unwind: {
                path: "$user",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                movie_id: 1,
                booking_id: 1,
                rating: 1,
                comment: 1,
                created_at: 1,
                verified_booking: { $literal: true },
                user: {
                  _id: "$user_id",
                  name: { $ifNull: ["$user.name", "Anonymous"] },
                },
              },
            },
          ],
          meta: [{ $count: "total" }],
        },
      },
    ]);

    const reviews = Array.isArray(result.data) ? result.data : [];
    const total = result.meta?.[0]?.total ?? 0;

    return res.status(200).json({
      success: true,
      data: reviews,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + reviews.length < total,
      },
      summary: {
        avg_rating: Number(movie.avg_rating ?? 0),
        total_reviews: Number(movie.total_reviews ?? total),
      },
    });
  } catch (error) {
    console.error("Failed to fetch reviews:", error);
    return res.status(500).json({ message: "Failed to fetch reviews" });
  }
};


export const getReviewForUser = async (req, res) => {
  try {
    const userId = normalizeString(req.user?.id);

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const page = parsePositiveInteger(req.query.page, 1);
    const limit = Math.min(parsePositiveInteger(req.query.limit, 10), 20);
    const skip = (page - 1) * limit;

    const [result = {}] = await Review.aggregate([
      {
        $match: { user_id: userId },
      },
      {
        $sort: { created_at: -1 },
      },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "movies",
                let: { movieId: "$movie_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: "$_id" }, "$$movieId"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                      imageUrl: 1,
                      language: 1,
                      genre: 1,
                      runtimeMinutes: 1,
                      avg_rating: 1,
                      total_reviews: 1,
                    },
                  },
                ],
                as: "movie",
              },
            },
            {
              $unwind: {
                path: "$movie",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "bookings",
                let: { bookingId: "$booking_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [{ $toString: "$_id" }, "$$bookingId"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      cinemaId: 1,
                      date: 1,
                      slot: 1,
                      seatIds: 1,
                      amount: 1,
                      status: 1,
                      showType: 1,
                      createdAt: 1,
                    },
                  },
                ],
                as: "booking",
              },
            },
            {
              $unwind: {
                path: "$booking",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                movie_id: 1,
                booking_id: 1,
                rating: 1,
                comment: 1,
                created_at: 1,
                verified_booking: { $literal: true },
                movie: {
                  _id: "$movie_id",
                  name: { $ifNull: ["$movie.name", "Movie unavailable"] },
                  imageUrl: "$movie.imageUrl",
                  language: "$movie.language",
                  genre: { $ifNull: ["$movie.genre", []] },
                  runtimeMinutes: "$movie.runtimeMinutes",
                  avg_rating: { $ifNull: ["$movie.avg_rating", 0] },
                  total_reviews: { $ifNull: ["$movie.total_reviews", 0] },
                },
                booking: {
                  _id: "$booking_id",
                  cinemaId: "$booking.cinemaId",
                  date: "$booking.date",
                  slot: "$booking.slot",
                  seatIds: { $ifNull: ["$booking.seatIds", []] },
                  amount: { $ifNull: ["$booking.amount", 0] },
                  status: "$booking.status",
                  showType: "$booking.showType",
                  createdAt: "$booking.createdAt",
                },
              },
            },
          ],
          meta: [{ $count: "total" }],
        },
      },
    ]);

    const reviews = Array.isArray(result.data) ? result.data : [];
    const total = result.meta?.[0]?.total ?? 0;

    return res.status(200).json({
      success: true,
      data: reviews,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + reviews.length < total,
      },
      summary: {
        total_reviews: total,
      },
    });
  } catch (error) {
    console.error("Failed to fetch user reviews:", error);
    return res.status(500).json({ message: "Failed to fetch your reviews" });
  }
};
