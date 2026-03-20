import express from "express";
import {
  createOrder,
  markPaymentFailed,
  payWithWallet,
  preparePayment,
  verifyPayment,
} from "../controllers/payment.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.post("/events/payment/prepare", authMiddleware, preparePayment);
router.post("/events/payment/create-order", authMiddleware, createOrder);
router.post("/events/payment/verify", authMiddleware, verifyPayment);
router.post("/events/payment/wallet-pay", authMiddleware, payWithWallet);
router.post("/events/payment/fail", authMiddleware, markPaymentFailed);

export default router;
