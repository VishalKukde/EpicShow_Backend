import express from "express";
import { createMovie, getMovieById, getMovies } from "../controller/movie.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/movies", getMovies);
router.get("/movies/:id", getMovieById);
router.post("/movies", authMiddleware, createMovie);

export default router;
