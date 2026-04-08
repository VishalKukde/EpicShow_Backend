import express from "express";
import {
  createGaming,
  getGaming,
  getGamingById,
} from "../controllers/gaming.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/gaming", getGaming);
router.get("/gaming/:id", getGamingById);
router.post("/gaming", authMiddleware, createGaming);

export default router;
