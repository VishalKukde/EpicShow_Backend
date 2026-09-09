import express from "express";
import {
  handleChatStream,
  handleHealthCheck,
  optionalAuth,
} from "../controllers/userAi.controller.js";

const router = express.Router();

// SSE Chat streaming endpoint (supports both guest and authenticated users)
router.post("/chat/stream", optionalAuth, handleChatStream);

// Health check endpoint
router.get("/health", handleHealthCheck);

export default router;
