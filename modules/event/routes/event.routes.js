import express from "express";
import {
  createEvent,
  getEventById,
  getEvents,
} from "../controllers/event.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/events", getEvents);
router.get("/events/:id", getEventById);
router.post("/events", authMiddleware, createEvent);

export default router;
