import express from "express";
import { getMovieDetails, getUpcomingMovies } from "../controllers/tmdb.controller.js";

const router = express.Router();

router.get("/upcoming", getUpcomingMovies);
router.get("/movie/:id", getMovieDetails);

export default router;
