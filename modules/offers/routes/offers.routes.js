import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  collectCoupon,
  getEligibleCoupons,
  getMyCoupons,
  getOfferCategoryCoupons,
  getOffers,
} from "../controller/offers.controller.js";

const router = express.Router();

router.get("/my-coupons/eligible", authMiddleware, getEligibleCoupons);
router.get("/my-coupons", authMiddleware, getMyCoupons);
router.post("/offers/coupons/:couponId/collect", authMiddleware, collectCoupon);
router.get("/offers/:category", getOfferCategoryCoupons);
router.get("/offers", getOffers);

export default router;
