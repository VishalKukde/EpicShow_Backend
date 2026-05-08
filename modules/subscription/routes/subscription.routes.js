import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  cancelUserSubscription,
  createSubscriptionCheckoutOrder,
  getCurrentSubscriptionStatus,
  markSubscriptionCheckoutFailed,
  paySubscriptionCheckoutWithWallet,
  prepareSubscriptionCheckout,
  upgradeSubscription,
  verifySubscriptionCheckoutPayment,
} from "../controller/subscription.controller.js";

const router = express.Router();

router.post("/subscription/upgrade", authMiddleware, upgradeSubscription);
router.post("/subscription/cancel", authMiddleware, cancelUserSubscription);
router.get("/subscription/status", authMiddleware, getCurrentSubscriptionStatus);
router.post("/subscription/checkout/prepare", authMiddleware, prepareSubscriptionCheckout);
router.post("/subscription/checkout/create-order", authMiddleware, createSubscriptionCheckoutOrder);
router.post("/subscription/checkout/verify", authMiddleware, verifySubscriptionCheckoutPayment);
router.post("/subscription/checkout/wallet-pay", authMiddleware, paySubscriptionCheckoutWithWallet);
router.post("/subscription/checkout/fail", authMiddleware, markSubscriptionCheckoutFailed);

export default router;
