import express from "express";
import requireSectionEnabled from "../../sections/middleware/requireSectionEnabled.js";
import {
  createOrder,
  markPaymentFailed,
  payWithWallet,
  preparePayment,
  verifyPayment,
} from "../controllers/payment.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.post("/gaming/payment/prepare", authMiddleware, requireSectionEnabled("gaming"), preparePayment);
router.post("/gaming/payment/create-order", authMiddleware, requireSectionEnabled("gaming"), createOrder);
router.post("/gaming/payment/verify", authMiddleware, verifyPayment);
router.post("/gaming/payment/wallet-pay", authMiddleware, requireSectionEnabled("gaming"), payWithWallet);
router.post("/gaming/payment/fail", authMiddleware, markPaymentFailed);

export default router;
