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

router.post("/sports/payment/prepare", authMiddleware, preparePayment);
router.post("/sports/payment/create-order", authMiddleware, createOrder);
router.post("/sports/payment/verify", authMiddleware, verifyPayment);
router.post("/sports/payment/fail", authMiddleware, markPaymentFailed);
router.post("/sports/payment/wallet-pay", authMiddleware, payWithWallet);

export default router;
