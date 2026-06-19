import express from "express";
import * as trainController from "../controllers/train.controller.js";
import {
  createTrainOrder,
  markTrainPaymentFailed,
  payTrainWithWallet,
  prepareTrainPayment,
  verifyTrainPayment,
} from "../controllers/train.payment.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};

// Public routes
router.get("/", trainController.getAllTrains);
router.get("/search", trainController.searchTrains);
router.get("/available", trainController.getAvailableTrains);

// User routes (protected)
router.get("/passengers", authMiddleware, trainController.getSavedPassengers);
router.post("/passengers", authMiddleware, trainController.savePassenger);
router.post("/payment/prepare", authMiddleware, prepareTrainPayment);
router.post("/payment/create-order", authMiddleware, createTrainOrder);
router.post("/payment/verify", authMiddleware, verifyTrainPayment);
router.post("/payment/fail", authMiddleware, markTrainPaymentFailed);
router.post("/payment/wallet-pay", authMiddleware, payTrainWithWallet);
router.post("/book", authMiddleware, trainController.bookTrain);
router.get("/user/bookings", authMiddleware, trainController.getUserBookings);
router.get("/bookings/profile", authMiddleware, trainController.getProfileTrainBookings);
router.get("/booking/pnr/:pnr", trainController.getBookingByPNR);
router.get("/booking/:id", authMiddleware, trainController.getTrainBooking);
router.put("/cancel/:bookingId", authMiddleware, trainController.cancelBooking);

// Admin routes (protected)
router.post("/admin/create", authMiddleware, requireAdmin, trainController.createTrain);
router.put("/admin/:id", authMiddleware, requireAdmin, trainController.updateTrain);
router.delete("/admin/:id", authMiddleware, requireAdmin, trainController.deleteTrain);
router.get("/admin/stats", authMiddleware, requireAdmin, trainController.getTrainStats);
router.get("/:id", trainController.getTrainById);

export default router;
