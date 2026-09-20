import express from "express";
import authMiddleware from "../../../middleware/auth.middleware.js";
import {
  broadcastNotification,
  deleteNotification,
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
router.delete("/notifications/:id", authMiddleware, deleteNotification);

export default router;
