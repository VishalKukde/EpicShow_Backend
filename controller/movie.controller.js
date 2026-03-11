import Movie from "../models/Movie.js";

export const getMovies = async (req, res) => {
  try {
   const movies = await Movie.find().limit(10);
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
