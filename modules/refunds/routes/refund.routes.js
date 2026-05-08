import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import { getRefundTransactions } from "../controllers/refund.controller.js";

const router = express.Router();
router.get("/", authMiddleware, getRefundTransactions);

export default router;
