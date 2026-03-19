import express from "express";
import {
  cancelBooking,
  getAllMovieBookings,
  getBooking,
  getLatestBookings,
  getUserBookingStats,
} from "../controllers/booking.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/bookings/movies", authMiddleware, getAllMovieBookings);
router.get("/bookings/stats", authMiddleware, getUserBookingStats);
router.get("/bookings/latest", authMiddleware, getLatestBookings);
router.get("/booking/:id", authMiddleware, getBooking);
router.patch("/cancel/:id", authMiddleware, cancelBooking);

export default router;
