import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  createWalletOrder,
  getWalletTransactions,
  verifyWalletPayment,
} from "../controller/wallet.controller.js";

const router = express.Router();

router.post("/wallet/create-order", authMiddleware, createWalletOrder);
router.post("/wallet/verify", authMiddleware, verifyWalletPayment);
router.get("/wallet/transactions", authMiddleware, getWalletTransactions);

export default router;
