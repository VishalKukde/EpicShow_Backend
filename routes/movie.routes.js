import express from "express";
import { getMovieById, getMovies } from "../controller/movie.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/movies", getMovies);
router.get("/movies/:id", getMovieById);

export default router;
