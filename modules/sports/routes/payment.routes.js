import express from "express";
import {
  createOrder,
  payWithWallet,
  preparePayment,
  verifyPayment,
} from "../controllers/payment.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.post("/payment/prepare", authMiddleware, preparePayment);
router.post("/payment/create-order", authMiddleware, createOrder);
router.post("/payment/verify", authMiddleware, verifyPayment);
router.post("/payment/wallet-pay", authMiddleware, payWithWallet);

export default router;
