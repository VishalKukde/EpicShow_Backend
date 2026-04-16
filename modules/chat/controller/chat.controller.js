import mongoose from "mongoose";
import ChatMessage from "../model/ChatMessage.js";
import User from "../../user/model/User.js";
import { emitConversationCleared, isUserOnline } from "../socket/chat.socket.js";

const MAX_MESSAGES_PER_THREAD = 300;
const EXCLUDED_CHAT_ROLES = ["admin", "manager"];

const toIdString = (value) => (value ? String(value) : "");

const serializeMessage = (message) => {
  const senderDoc =
    message?.senderId && typeof message.senderId === "object"
      ? message.senderId
      : null;

  return {
    id: toIdString(message._id),
    conversationUserId: toIdString(message.conversationUserId),
    senderId: toIdString(senderDoc?._id || message.senderId),
    senderRole: message.senderRole,
    recipientId: message.recipientId ? toIdString(message.recipientId) : null,
    recipientRole: message.recipientRole,
    text: message.text,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    sender: senderDoc
      ? {
          id: toIdString(senderDoc._id),
          name: senderDoc.name,
          role: senderDoc.role,
          avatar: senderDoc.avatar || null,
        }
      : null,
  };
};

const serializeChatUser = (user) => ({
  id: toIdString(user._id),
  name: user.name,
  email: user.email,
  avatar: user.avatar || null,
});

const ensureAdmin = (req, res) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "Admin access required" });
    return false;
  }
  return true;
};

export const getAdminUsersForChat = async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  try {
    const users = await User.find({
      role: { $nin: EXCLUDED_CHAT_ROLES },
    })
      .select("_id name email avatar createdAt lastLogin")
      .lean();

    if (!users.length) {
      return res.json({ users: [] });
    }

    const userIds = users.map((item) => item._id);

    const [lastMessages, unreadCounts] = await Promise.all([
      ChatMessage.aggregate([
        { $match: { conversationUserId: { $in: userIds } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$conversationUserId",
            lastMessage: { $first: "$text" },
            lastMessageAt: { $first: "$createdAt" },
            lastSenderRole: { $first: "$senderRole" },
          },
        },
      ]),
      ChatMessage.aggregate([
        {
          $match: {
            conversationUserId: { $in: userIds },
            senderRole: "user",
            isReadByAdmin: false,
          },
        },
        {
          $group: {
            _id: "$conversationUserId",
            unreadCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const lastMessageMap = new Map(
      lastMessages.map((item) => [toIdString(item._id), item])
    );
    const unreadMap = new Map(
      unreadCounts.map((item) => [toIdString(item._id), item.unreadCount ?? 0])
    );

    const payload = users
      .map((chatUser) => {
        const key = toIdString(chatUser._id);
        const last = lastMessageMap.get(key);

        return {
          ...serializeChatUser(chatUser),
          online: isUserOnline(chatUser._id),
          unreadCount: unreadMap.get(key) ?? 0,
          lastMessage: last?.lastMessage ?? "",
          lastMessageAt: last?.lastMessageAt ?? null,
          lastSenderRole: last?.lastSenderRole ?? null,
          lastLogin: chatUser.lastLogin ?? null,
          createdAt: chatUser.createdAt ?? null,
        };
      })
      .sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;

        if (aTime !== bTime) return bTime - aTime;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    return res.json({ users: payload });
  } catch (error) {
    console.error("getAdminUsersForChat error:", error);
    return res.status(500).json({ message: "Unable to fetch chat users" });
  }
};

export const getMyConversation = async (req, res) => {
  if (req.user?.role === "admin") {
    return res
      .status(400)
      .json({ message: "Admin should fetch conversation by user id." });
  }

  try {
    const userId = req.user?.id || req.user?._id;
    const conversationUserId = new mongoose.Types.ObjectId(userId);

    const [messages] = await Promise.all([
      ChatMessage.find({ conversationUserId })
        .sort({ createdAt: 1 })
        .limit(MAX_MESSAGES_PER_THREAD)
        .populate("senderId", "_id name role avatar")
        .lean(),
      ChatMessage.updateMany(
        {
          conversationUserId,
          senderRole: "admin",
          isReadByUser: false,
        },
        { $set: { isReadByUser: true } }
      ),
    ]);

    return res.json({
      messages: messages.map(serializeMessage),
    });
  } catch (error) {
    console.error("getMyConversation error:", error);
    return res.status(500).json({ message: "Unable to fetch conversation" });
  }
};

export const getConversationForAdmin = async (req, res) => {
  if (!ensureAdmin(req, res)) return;

  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const chatUser = await User.findOne({
      _id: userId,
      role: { $nin: EXCLUDED_CHAT_ROLES },
    })
      .select("_id name email avatar")
      .lean();

    if (!chatUser) {
      return res.status(404).json({ message: "Chat user not found" });
    }

    const conversationUserId = new mongoose.Types.ObjectId(userId);

    const [messages] = await Promise.all([
      ChatMessage.find({ conversationUserId })
        .sort({ createdAt: 1 })
        .limit(MAX_MESSAGES_PER_THREAD)
        .populate("senderId", "_id name role avatar")
        .lean(),
      ChatMessage.updateMany(
        {
          conversationUserId,
          senderRole: "user",
          isReadByAdmin: false,
        },
        { $set: { isReadByAdmin: true } }
      ),
    ]);

    return res.json({
      user: serializeChatUser(chatUser),
      messages: messages.map(serializeMessage),
    });
  } catch (error) {
    console.error("getConversationForAdmin error:", error);
    return res.status(500).json({ message: "Unable to fetch conversation" });
  }
};

export const clearConversation = async (req, res) => {
  try {
    const requesterRole = req.user?.role === "admin" ? "admin" : "user";
    const requesterId = req.user?.id || req.user?._id;

    let conversationUserId = toIdString(requesterId);

    if (requesterRole === "admin") {
      const userId =
        typeof req.query?.userId === "string" ? req.query.userId.trim() : "";

      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: "Valid user id is required" });
      }

      const chatUser = await User.findOne({
        _id: userId,
        role: { $nin: EXCLUDED_CHAT_ROLES },
      })
        .select("_id")
        .lean();

      if (!chatUser) {
        return res.status(404).json({ message: "Chat user not found" });
      }

      conversationUserId = toIdString(chatUser._id);
    } else if (!mongoose.isValidObjectId(conversationUserId)) {
      return res.status(400).json({ message: "Invalid user session" });
    }

    const conversationObjectId = new mongoose.Types.ObjectId(conversationUserId);
    const deleteResult = await ChatMessage.deleteMany({
      conversationUserId: conversationObjectId,
    });

    emitConversationCleared({
      conversationUserId,
      clearedByUserId: requesterId,
      clearedByRole: requesterRole,
    });

    return res.json({
      message: "Chat conversation cleared",
      conversationUserId,
      deletedCount: deleteResult?.deletedCount ?? 0,
    });
  } catch (error) {
    console.error("clearConversation error:", error);
    return res.status(500).json({ message: "Unable to clear conversation" });
  }
};
