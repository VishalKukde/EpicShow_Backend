import Movie from "../models/Movie.js";

export const getMovies = async (req, res) => {
  try {
   const movies = await Movie.find();
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
    return res.status(201).json(Array.isArray(payload) ? created : created[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create movie" });
  }
};
