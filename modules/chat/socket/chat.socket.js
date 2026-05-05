import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import ChatMessage from "../model/ChatMessage.js";
import User from "../../user/model/User.js";

const USER_ROOM_PREFIX = "user:";
const ADMIN_ROOM = "admins";
const EXCLUDED_CHAT_ROLES = ["admin", "manager"];
const onlineUsers = new Map();
const onlineAdminSocketIds = new Set();
let chatIo = null;

const toIdString = (value) => (value ? String(value) : "");

const serializeMessage = (message, sender) => ({
  id: toIdString(message._id),
  conversationUserId: toIdString(message.conversationUserId),
  senderId: toIdString(message.senderId),
  senderRole: message.senderRole,
  recipientId: message.recipientId ? toIdString(message.recipientId) : null,
  recipientRole: message.recipientRole,
  text: message.text,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
  sender: sender
    ? {
        id: sender.id,
        name: sender.name,
        role: sender.role,
        avatar: sender.avatar || null,
      }
    : null,
});

const addOnlineSocket = (userId, socketId) => {
  const key = toIdString(userId);
  const sockets = onlineUsers.get(key) ?? new Set();
  sockets.add(socketId);
  onlineUsers.set(key, sockets);
};

const removeOnlineSocket = (userId, socketId) => {
  const key = toIdString(userId);
  const sockets = onlineUsers.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(key);
  }
};

export const isUserOnline = (userId) => onlineUsers.has(toIdString(userId));

const getAdminPresencePayload = () => ({
  online: onlineAdminSocketIds.size > 0,
  onlineCount: onlineAdminSocketIds.size,
});

export const emitConversationCleared = (payload = {}) => {
  if (!chatIo) return;

  const conversationUserId = toIdString(payload?.conversationUserId);
  if (!conversationUserId) return;

  const clearedByUserId = toIdString(payload?.clearedByUserId) || null;
  const clearedByRole = payload?.clearedByRole === "admin" ? "admin" : "user";
  const clearedAt = new Date().toISOString();

  const eventPayload = {
    conversationUserId,
    clearedByUserId,
    clearedByRole,
    clearedAt,
  };

  chatIo.to(ADMIN_ROOM).emit("chat:conversation:cleared", eventPayload);
  chatIo
    .to(`${USER_ROOM_PREFIX}${conversationUserId}`)
    .emit("chat:conversation:cleared", eventPayload);
};

export const emitUserNotification = (userId, payload = {}) => {
  if (!chatIo) return;

  const targetUserId = toIdString(userId);
  if (!targetUserId || !payload?.id) return;

  chatIo
    .to(`${USER_ROOM_PREFIX}${targetUserId}`)
    .emit("notification:new", payload);
};

export const initializeChatSocket = (io) => {
  chatIo = io;

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Unauthorized"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id)
        .select("_id name role avatar tokenVersion")
        .lean();

      if (!user) {
        return next(new Error("Unauthorized"));
      }

      const requestTokenVersion = Number(decoded?.tokenVersion ?? 0);
      const currentTokenVersion = Number(user?.tokenVersion ?? 0);
      if (requestTokenVersion !== currentTokenVersion) {
        return next(new Error("Unauthorized"));
      }

      socket.data.user = {
        id: toIdString(user._id),
        name: user.name,
        role: user.role,
        avatar: user.avatar || null,
      };

      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const currentUser = socket.data.user;
    if (!currentUser?.id) {
      socket.disconnect(true);
      return;
    }

    const userRoom = `${USER_ROOM_PREFIX}${currentUser.id}`;
    socket.join(userRoom);
    if (currentUser.role === "admin") {
      socket.join(ADMIN_ROOM);
    }

    addOnlineSocket(currentUser.id, socket.id);

    if (currentUser.role === "user") {
      io.to(ADMIN_ROOM).emit("chat:user:status", {
        userId: currentUser.id,
        online: true,
      });
      socket.emit("chat:admin:status", getAdminPresencePayload());
    } else if (currentUser.role === "admin") {
      onlineAdminSocketIds.add(socket.id);
      io.emit("chat:admin:status", getAdminPresencePayload());
    }

    socket.on("chat:typing", (payload = {}) => {
      const isTyping = Boolean(payload?.isTyping);

      if (currentUser.role === "user") {
        io.to(ADMIN_ROOM).emit("chat:typing", {
          conversationUserId: currentUser.id,
          userId: currentUser.id,
          role: "user",
          isTyping,
        });
        return;
      }

      const targetUserId =
        typeof payload?.targetUserId === "string"
          ? payload.targetUserId.trim()
          : "";

      if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
        return;
      }

      io.to(`${USER_ROOM_PREFIX}${targetUserId}`).emit("chat:typing", {
        conversationUserId: targetUserId,
        userId: currentUser.id,
        role: "admin",
        isTyping,
      });
    });

    socket.on("chat:send", async (payload, ack) => {
      const respond =
        typeof ack === "function" ? ack : () => {};

      try {
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!text) {
          respond({ ok: false, message: "Message is required" });
          return;
        }

        let conversationUserId = currentUser.id;
        let recipientId = null;
        let recipientRole = "admin";

        if (currentUser.role === "admin") {
          const targetUserId =
            typeof payload?.targetUserId === "string"
              ? payload.targetUserId.trim()
              : "";

          if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
            respond({ ok: false, message: "Valid target user is required" });
            return;
          }

          const targetUser = await User.findOne({
            _id: targetUserId,
            role: { $nin: EXCLUDED_CHAT_ROLES },
          })
            .select("_id")
            .lean();

          if (!targetUser) {
            respond({ ok: false, message: "User not found" });
            return;
          }

          conversationUserId = toIdString(targetUser._id);
          recipientId = conversationUserId;
          recipientRole = "user";
        }

        const message = await ChatMessage.create({
          conversationUserId,
          senderId: currentUser.id,
          senderRole: currentUser.role,
          recipientId,
          recipientRole,
          text,
          isReadByAdmin: currentUser.role === "admin",
          isReadByUser: currentUser.role === "user",
        });

        const serialized = serializeMessage(message, currentUser);

        io.to(ADMIN_ROOM).emit("chat:message", serialized);
        io.to(`${USER_ROOM_PREFIX}${serialized.conversationUserId}`).emit(
          "chat:message",
          serialized
        );

        io.to(ADMIN_ROOM).emit("chat:conversation:update", {
          userId: serialized.conversationUserId,
          lastMessage: serialized.text,
          lastMessageAt: serialized.createdAt,
          senderRole: serialized.senderRole,
          unreadCountDelta: serialized.senderRole === "user" ? 1 : 0,
        });

        if (currentUser.role === "user") {
          io.to(ADMIN_ROOM).emit("chat:typing", {
            conversationUserId: currentUser.id,
            userId: currentUser.id,
            role: "user",
            isTyping: false,
          });
        } else {
          io.to(`${USER_ROOM_PREFIX}${serialized.conversationUserId}`).emit("chat:typing", {
            conversationUserId: serialized.conversationUserId,
            userId: currentUser.id,
            role: "admin",
            isTyping: false,
          });
        }

        respond({ ok: true, message: serialized });
      } catch (error) {
        console.error("chat:send error:", error);
        respond({ ok: false, message: "Unable to send message" });
      }
    });

    socket.on("disconnect", () => {
      removeOnlineSocket(currentUser.id, socket.id);

      if (currentUser.role === "admin") {
        onlineAdminSocketIds.delete(socket.id);
        io.emit("chat:admin:status", getAdminPresencePayload());
        return;
      }

      io.to(ADMIN_ROOM).emit("chat:typing", {
        conversationUserId: currentUser.id,
        userId: currentUser.id,
        role: "user",
        isTyping: false,
      });

      if (currentUser.role === "user" && !isUserOnline(currentUser.id)) {
        io.to(ADMIN_ROOM).emit("chat:user:status", {
          userId: currentUser.id,
          online: false,
        });
      }
    });
  });
};
