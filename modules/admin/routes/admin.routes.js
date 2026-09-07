import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  getAdminBookings,
  getAdminDashboard,
  getAdminOrders,
  getAdminUsers,
  refundAdminOrder,
  updateUserStatus,
} from "../controllers/dashboard.controller.js";
import {
  allocateCouponToUsers,
  createAdminCoupon,
  deleteAdminCoupon,
  getAdminCoupons,
  getCouponAllocations,
  getUsersForAllocation,
  updateAdminCoupon,
} from "../controllers/coupon.controller.js";

const router = express.Router();

router.get("/dashboard", authMiddleware, getAdminDashboard);
router.get("/bookings/:type", authMiddleware, getAdminBookings);
router.get("/orders", authMiddleware, getAdminOrders);
router.get("/users", authMiddleware, getAdminUsers);
router.patch("/users/status", authMiddleware, updateUserStatus);
router.patch("/users/:userId/status", authMiddleware, updateUserStatus);
router.patch("/orders/:id/refund", authMiddleware, refundAdminOrder);

// Admin Coupon Management
router.get("/coupons", authMiddleware, getAdminCoupons);
router.post("/coupons", authMiddleware, createAdminCoupon);
router.patch("/coupons/:id", authMiddleware, updateAdminCoupon);
router.delete("/coupons/:id", authMiddleware, deleteAdminCoupon);
router.get("/coupons/:id/allocations", authMiddleware, getCouponAllocations);
router.post("/coupons/:id/allocate", authMiddleware, allocateCouponToUsers);
router.get("/coupons-users", authMiddleware, getUsersForAllocation);

export default router;
