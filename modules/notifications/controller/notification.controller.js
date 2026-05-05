import Notification from "../model/Notification.js";

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

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      notifications: notifications.map(serializeNotification),
    });
  } catch (error) {
    console.error("getNotifications error:", error);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

export const markNotificationsRead = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id) => String(id)).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return res.json({ success: true, modifiedCount: 0 });
    }

    const result = await Notification.updateMany(
      {
        _id: { $in: ids },
        user: req.user.id,
        readAt: null,
      },
      { $set: { readAt: new Date() } }
    );

    return res.json({
      success: true,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error("markNotificationsRead error:", error);
    return res.status(500).json({ message: "Failed to update notifications" });
  }
};
