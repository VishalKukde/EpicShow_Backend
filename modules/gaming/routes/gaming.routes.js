import express from "express";
import {
  createGaming,
  deleteGaming,
  getGaming,
  getGamingById,
  updateGaming,
} from "../controllers/gaming.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/gaming", getGaming);
router.get("/gaming/:id", getGamingById);
router.post("/gaming", authMiddleware, createGaming);
router.put("/gaming/:id", authMiddleware, updateGaming);
router.delete("/gaming/:id", authMiddleware, deleteGaming);

export default router;
