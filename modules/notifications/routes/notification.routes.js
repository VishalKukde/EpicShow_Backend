import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  broadcastNotification,
  getBroadcastCampaigns,
  getNotifications,
  getUnreadCount,
  markNotificationsRead,
} from "../controller/notification.controller.js";

const router = express.Router();

router.get("/notifications", authMiddleware, getNotifications);
router.get("/notifications/unread-count", authMiddleware, getUnreadCount);
router.patch("/notifications/read", authMiddleware, markNotificationsRead);
router.post("/notifications/broadcast", authMiddleware, broadcastNotification);
router.get("/notifications/broadcasts", authMiddleware, getBroadcastCampaigns);

export default router;
