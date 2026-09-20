import mongoose from "mongoose";
import Notification from "../model/Notification.js";
import BroadcastCampaign from "../model/BroadcastCampaign.js";
import User from "../../user/model/User.js";
import { addBroadcastNotificationJob } from "../queues/notification.queue.js";

const serializeNotification = (notification) => ({
  id: String(notification._id),
  type: notification.type,
  title: notification.title,
  message: notification.message,
  amount: notification.amount,
  metadata: notification.metadata || {},
  readAt: notification.readAt,
  createdAt: notification.createdAt,
});

export const getNotifications = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const unreadOnly = req.query.unread === "true";
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 100)
        : 50;

    const filter = {
      user: req.user.id,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({
        user: req.user.id,
        readAt: null,
      }),
    ]);

    return res.json({
      notifications: notifications.map(serializeNotification),
      unreadCount,
    });
  } catch (error) {
    console.error("getNotifications error:", error);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const unreadCount = await Notification.countDocuments({
      user: req.user.id,
      readAt: null,
    });

    return res.json({ unreadCount });
  } catch (error) {
    console.error("getUnreadCount error:", error);
    return res.status(500).json({ message: "Failed to fetch unread count" });
  }
};

export const markNotificationsRead = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const markAll = req.body?.all === true;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id) => String(id)).filter(Boolean)
      : [];

    if (!markAll && ids.length === 0) {
      const unreadCount = await Notification.countDocuments({
        user: req.user.id,
        readAt: null,
      });
      return res.json({ success: true, modifiedCount: 0, unreadCount });
    }

    const filter = {
      user: req.user.id,
      readAt: null,
      ...(markAll ? {} : { _id: { $in: ids } }),
    };

    const result = await Notification.updateMany(filter, {
      $set: { readAt: new Date() },
    });

    const unreadCount = await Notification.countDocuments({
      user: req.user.id,
      readAt: null,
    });

    return res.json({
      success: true,
      modifiedCount: result.modifiedCount || 0,
      unreadCount,
    });
  } catch (error) {
    console.error("markNotificationsRead error:", error);
    return res.status(500).json({ message: "Failed to update notifications" });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const result = await Notification.deleteOne({ _id: id, user: req.user.id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const unreadCount = await Notification.countDocuments({
      user: req.user.id,
      readAt: null,
    });

    return res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("deleteNotification error:", error);
    return res.status(500).json({ message: "Failed to delete notification" });
  }
};

export const broadcastNotification = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : typeof req.body?.body === "string"
        ? req.body.body.trim()
        : "";

    if (!title || !message) {
      return res.status(400).json({ message: "Title and message are required" });
    }

    const channel = req.body?.channel || "Push Notification";
    const targetSegment = req.body?.targetSegment || "All Registered Users";
    const deepLink = req.body?.deepLink || "";

    const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create BroadcastCampaign record immediately so it appears instantly in UI
    try {
      await BroadcastCampaign.create({
        broadcastId,
        title,
        message,
        channel,
        targetSegment,
        deepLink,
        status: "Processing",
        sentCount: 0,
        readCount: 0,
        dispatchedAt: new Date(),
        createdBy: req.user.id,
      });
    } catch (campaignErr) {
      console.warn("Could not pre-save BroadcastCampaign record:", campaignErr.message);
    }

    const job = await addBroadcastNotificationJob({
      broadcastId,
      title,
      message,
      channel,
      targetSegment,
      deepLink,
      adminId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: "Broadcast notification queued successfully",
      broadcastId,
      jobId: job.id,
    });
  } catch (error) {
    console.error("broadcastNotification error:", error);
    return res.status(500).json({ message: "Failed to queue broadcast notification" });
  }
};

export const getBroadcastCampaigns = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    // 1. Fetch real user and audience stats
    const totalUsers = await User.countDocuments({
      role: { $ne: "admin" },
      status: { $ne: "Deactivated" },
    });
    const proUsers = await User.countDocuments({
      role: { $ne: "admin" },
      status: { $ne: "Deactivated" },
      membership: "pro",
    });
    const freeUsers = await User.countDocuments({
      role: { $ne: "admin" },
      status: { $ne: "Deactivated" },
      membership: { $ne: "pro" },
    });

    // 2. Aggregate real broadcasts from Notification collection
    const rawAgg = await Notification.aggregate([
      { $match: { type: "broadcast" } },
      {
        $group: {
          _id: "$metadata.broadcastId",
          title: { $first: "$title" },
          message: { $first: "$message" },
          channel: { $first: "$metadata.channel" },
          targetSegment: { $first: "$metadata.targetSegment" },
          deepLink: { $first: "$metadata.deepLink" },
          dispatchedAt: { $min: "$createdAt" },
          sentCount: { $sum: 1 },
          readCount: {
            $sum: { $cond: [{ $ifNull: ["$readAt", false] }, 1, 0] },
          },
        },
      },
      { $sort: { dispatchedAt: -1 } },
    ]);

    // 3. Query BroadcastCampaign collection to catch any in "Processing" state or without notifs
    const campaignDocs = await BroadcastCampaign.find().sort({ dispatchedAt: -1 }).lean();
    const campaignMap = new Map();
    campaignDocs.forEach((c) => {
      campaignMap.set(c.broadcastId, c);
    });

    const aggBroadcastIds = new Set();
    const campaigns = [];

    rawAgg.forEach((item) => {
      const bId = item._id || `BC-${Math.random().toString(36).substring(2, 7)}`;
      aggBroadcastIds.add(bId);
      const doc = campaignMap.get(bId);
      const sentCount = item.sentCount || doc?.sentCount || 0;
      const readCount = item.readCount || doc?.readCount || 0;
      const openRate =
        sentCount > 0 ? ((readCount / sentCount) * 100).toFixed(1) + "%" : "0.0%";

      campaigns.push({
        id: bId,
        title: item.title || doc?.title || "Push Broadcast Announcement",
        body: item.message || doc?.message || "",
        channel: item.channel || doc?.channel || "Push Notification",
        targetSegment: item.targetSegment || doc?.targetSegment || "All Registered Users",
        deepLink: item.deepLink || doc?.deepLink || "/movies",
        sentCount,
        readCount,
        openRate,
        dispatchedAt: item.dispatchedAt
          ? new Date(item.dispatchedAt).toISOString()
          : new Date().toISOString(),
        status: doc?.status || "Delivered",
      });
    });

    // Add any campaigns from BroadcastCampaign that weren't in rawAgg (e.g. still Processing)
    campaignDocs.forEach((doc) => {
      if (!aggBroadcastIds.has(doc.broadcastId)) {
        campaigns.push({
          id: doc.broadcastId,
          title: doc.title,
          body: doc.message,
          channel: doc.channel,
          targetSegment: doc.targetSegment,
          deepLink: doc.deepLink,
          sentCount: doc.sentCount || 0,
          readCount: doc.readCount || 0,
          openRate:
            doc.sentCount > 0
              ? ((doc.readCount / doc.sentCount) * 100).toFixed(1) + "%"
              : "0.0%",
          dispatchedAt: doc.dispatchedAt
            ? new Date(doc.dispatchedAt).toISOString()
            : new Date().toISOString(),
          status: doc.status || "Processing",
        });
      }
    });

    campaigns.sort(
      (a, b) => new Date(b.dispatchedAt).getTime() - new Date(a.dispatchedAt).getTime()
    );

    // 4. Calculate KPI stats
    const totalDelivered = campaigns.reduce((acc, c) => acc + (c.sentCount || 0), 0);
    const totalRead = campaigns.reduce((acc, c) => acc + (c.readCount || 0), 0);
    const averageOpenRate =
      totalDelivered > 0 ? ((totalRead / totalDelivered) * 100).toFixed(1) + "%" : "0.0%";

    return res.status(200).json({
      success: true,
      campaigns,
      stats: {
        totalSubscribers: totalUsers,
        totalCampaigns: campaigns.length,
        totalMessagesDelivered: totalDelivered,
        averageOpenRate,
        segmentCounts: {
          "All Registered Users": totalUsers,
          "Pro Plan Subscribers": proUsers,
          "Free Plan Users": freeUsers,
        },
      },
    });
  } catch (error) {
    console.error("getBroadcastCampaigns error:", error);
    return res.status(500).json({ message: "Failed to fetch broadcast campaigns" });
  }
};

