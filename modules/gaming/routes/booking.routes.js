import express from "express";
import { getGamingBooking, getGamingBookings } from "../controllers/booking.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/gaming/booking/:id", authMiddleware, getGamingBooking);
router.get("/bookings/gaming", authMiddleware, getGamingBookings);
router.get("/bookings/games", authMiddleware, getGamingBookings);

export default router;
