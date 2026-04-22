import { getRedisClient } from "../../../config/redis.js";
import Movie from "../models/Movie.js";

const WISHLIST_TTL_SECONDS = 10 * 24 * 60 * 60;

const getWishlistSetKey = (userId) => `wishlist:${userId}`;

const getWishlistItemKey = (userId, movieId) => `wishlist:${userId}:${movieId}`;

const getActiveWishlistMovieIds = async (redis, userId) => {
  const setKey = getWishlistSetKey(userId);
  const movieIds = await redis.sMembers(setKey);

  if (movieIds.length === 0) {
    return [];
  }

  const existenceChecks = await Promise.all(
    movieIds.map((movieId) => redis.exists(getWishlistItemKey(userId, movieId)))
  );

  const activeMovieIds = [];
  const expiredMovieIds = [];

  movieIds.forEach((movieId, index) => {
    if (existenceChecks[index]) {
      activeMovieIds.push(movieId);
      return;
    }

    expiredMovieIds.push(movieId);
  });

  if (expiredMovieIds.length > 0) {
    await redis.sRem(setKey, expiredMovieIds);
  }

  return activeMovieIds;
};

export const toggleWishlist = async (req, res) => {
  try {
    const redis = await getRedisClient();
    const userId = req.user.id;
    const { movieId } = req.body;
    const setKey = getWishlistSetKey(userId);
    const itemKey = getWishlistItemKey(userId, movieId);

    // Wishlist items are tracked per-movie so each one can expire independently.
    const isWishlisted = (await redis.exists(itemKey)) === 1;

    if (isWishlisted) {
      await Promise.all([redis.del(itemKey), redis.sRem(setKey, movieId)]);

      return res.json({
        success: true,
        action: "removed",
      });
    }

    await Promise.all([
      redis.sAdd(setKey, movieId),
      redis.set(itemKey, "1", { EX: WISHLIST_TTL_SECONDS }),
    ]);

    return res.json({
      success: true,
      action: "added",
      expiresInSeconds: WISHLIST_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Toggle Wishlist Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getWishlist = async (req, res) => {
  try {
    const redis = await getRedisClient();
    const userId = req.user.id;
    const movieIds = await getActiveWishlistMovieIds(redis, userId);
    if (movieIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const movies = await Movie.find({
      _id: { $in: movieIds },
    });

    return res.json({
      success: true,
      data: movies,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
