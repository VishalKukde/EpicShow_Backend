import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  createFeedback,
  getMyFeedback,
  getTestimonials,
} from "../controllers/feedback.controller.js";

const router = express.Router();

router.get("/feedback/testimonials", getTestimonials);
router.get("/feedback/me", authMiddleware, getMyFeedback);
router.post("/feedback", authMiddleware, createFeedback);

export default router;
