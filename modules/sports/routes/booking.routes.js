import express from "express";
import { getSportBooking, getSportBookings } from "../controllers/booking.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/sports/booking/:id", authMiddleware, getSportBooking);
router.get("/bookings/sports", authMiddleware, getSportBookings);

export default router;
