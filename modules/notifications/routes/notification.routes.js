import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  getNotifications,
  markNotificationsRead,
} from "../controller/notification.controller.js";

const router = express.Router();

router.get("/notifications", authMiddleware, getNotifications);
router.patch("/notifications/read", authMiddleware, markNotificationsRead);

export default router;
