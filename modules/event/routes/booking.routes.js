import express from "express";
import { getEventBooking, getEventBookings } from "../controllers/booking.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/events/booking/:id", authMiddleware, getEventBooking);
router.get("/bookings/events", authMiddleware, getEventBookings);

export default router;
