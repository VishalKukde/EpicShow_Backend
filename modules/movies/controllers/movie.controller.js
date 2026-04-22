import Movie from "../models/Movie.js";
import { getRedisClient } from "../../../config/redis.js";

const LATEST_RELEASES_CACHE_PREFIX = "movies:latest-releases";
const LATEST_RELEASES_CACHE_TTL_SECONDS = Math.max(
  Number(process.env.LATEST_RELEASES_CACHE_TTL_SECONDS) || 300,
  30
);

const buildLatestReleasesCacheKey = (limit) =>
  `${LATEST_RELEASES_CACHE_PREFIX}:limit:${limit}`;

const loadLatestReleasesFromDb = (limit) =>
  Movie.find({
    releaseDate: { $exists: true, $ne: null },
  })
    .sort({ releaseDate: -1 })
    .limit(limit)
    .lean();

const getLatestReleasesFromCache = async (limit) => {
  if (!process.env.REDIS_URL) {
    return null;
  }

  try {
    const redis = await getRedisClient();
    const cached = await redis.get(buildLatestReleasesCacheKey(limit));
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Failed to read latest releases cache:", error.message || error);
    return null;
  }
};

const setLatestReleasesCache = async (limit, movies) => {
  if (!process.env.REDIS_URL) {
    return;
  }

  try {
    const redis = await getRedisClient();
    await redis.set(buildLatestReleasesCacheKey(limit), JSON.stringify(movies), {
      EX: LATEST_RELEASES_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Failed to write latest releases cache:", error.message || error);
  }
};

const invalidateLatestReleasesCache = async () => {
  if (!process.env.REDIS_URL) {
    return;
  }

  try {
    const redis = await getRedisClient();
    for await (const keys of redis.scanIterator({
      MATCH: `${LATEST_RELEASES_CACHE_PREFIX}:*`,
      COUNT: 50,
    })) {
      const keyBatch = Array.isArray(keys) ? keys : [keys];
      if (keyBatch.length > 0) {
        await redis.del(keyBatch);
      }
    }
  } catch (error) {
    console.error("Failed to invalidate latest releases cache:", error.message || error);
  }
};

export const getMovies = async (req, res) => {
  try {
    const movies = await Movie.find();
    res.json(movies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getLatestReleases = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);

    const cachedMovies = await getLatestReleasesFromCache(limit);
    if (cachedMovies) {
      return res.json(cachedMovies);
    }

    const movies = await loadLatestReleasesFromDb(limit);
    await setLatestReleasesCache(limit, movies);

    res.json(movies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getMovieById = async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    res.json(movie);
  } catch (err) {
    res.status(404).json({ message: "Movie not found" });
  }
};

export const createMovie = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];

    const normalizeMovie = (raw) => {
      const {
        name,
        description,
        genre,
        imageUrl,
        language,
        runtimeMinutes,
        rating,
        releaseDate,
      } = raw || {};

      const missing = [];
      if (!name || typeof name !== "string" || !name.trim()) missing.push("name");
      if (!description || typeof description !== "string" || !description.trim()) {
        missing.push("description");
      }
      if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.trim()) {
        missing.push("imageUrl");
      }
      if (!language || typeof language !== "string" || !language.trim()) {
        missing.push("language");
      }
      if (!Array.isArray(genre) || genre.length === 0) missing.push("genre");
      if (runtimeMinutes === undefined || Number.isNaN(Number(runtimeMinutes))) {
        missing.push("runtimeMinutes");
      }
      if (rating !== undefined && Number.isNaN(Number(rating))) {
        missing.push("rating");
      }
      let releaseDateValue;
      if (releaseDate !== undefined && releaseDate !== null && String(releaseDate).trim() !== "") {
        const parsed = new Date(releaseDate);
        if (Number.isNaN(parsed.getTime())) {
          missing.push("releaseDate");
        } else {
          releaseDateValue = parsed;
        }
      }

      if (missing.length > 0) {
        return { error: missing };
      }

      const ratingValue =
        rating === undefined || rating === null || rating === ""
          ? Number((Math.random() * 4.9 + 5).toFixed(1))
          : Number(rating);

      return {
        name: name.trim(),
        description: description.trim(),
        genre: genre.map((item) => String(item).trim()).filter(Boolean),
        imageUrl: imageUrl.trim(),
        language: language.trim(),
        runtimeMinutes: Number(runtimeMinutes),
        rating: ratingValue,
        ...(releaseDateValue ? { releaseDate: releaseDateValue } : {}),
      };
    };

    const normalized = items.map(normalizeMovie);
    const invalidIndex = normalized.findIndex((item) => item && item.error);

    if (invalidIndex !== -1) {
      const invalid = normalized[invalidIndex];
      return res.status(400).json({
        message: `Missing or invalid fields in item ${invalidIndex + 1}: ${invalid.error.join(", ")}`,
      });
    }

    const created = await Movie.insertMany(normalized, { ordered: true });
    await invalidateLatestReleasesCache();

    return res.status(201).json(Array.isArray(payload) ? created : created[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create movie" });
  }
};
