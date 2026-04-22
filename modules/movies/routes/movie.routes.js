import express from "express";
import { createMovie, getLatestReleases, getMovieById, getMovies } from "../controllers/movie.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";
import { getWishlist, toggleWishlist } from "../controllers/wishlist.controller.js";

const router = express.Router();

router.get("/movies", getMovies);
router.get("/movies/latest", getLatestReleases);
router.get("/movies/:id", getMovieById);
router.post("/movies", authMiddleware, createMovie);
router.post("/wishlist", authMiddleware, toggleWishlist);
router.get("/getwishlist", authMiddleware, getWishlist);

export default router;
