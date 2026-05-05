import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  getAdminBookings,
  getAdminDashboard,
  getAdminOrders,
  getAdminUsers,
  refundAdminOrder,
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, getAdminDashboard);
router.get("/bookings/:type", authMiddleware, getAdminBookings);
router.get("/orders", authMiddleware, getAdminOrders);
router.get("/users", authMiddleware, getAdminUsers);
router.patch("/orders/:id/refund", authMiddleware, refundAdminOrder);

export default router;
