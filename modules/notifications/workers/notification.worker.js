import { Worker } from "bullmq";
import mongoose from "mongoose";
import { createBullRedisConnection } from "../../../config/bullmq.js";
import Notification from "../model/Notification.js";
import BroadcastCampaign from "../model/BroadcastCampaign.js";
import User from "../../user/model/User.js";
import { emitUserNotification, isUserOnline } from "../../chat/socket/chat.socket.js";

const QUEUE_NAME = "broadcast-notifications";
const BATCH_SIZE = 250;

let broadcastWorker = null;

export const processBroadcastJob = async (job) => {
  const {
    broadcastId,
    title,
    message,
    channel = "Push Notification",
    targetSegment = "All Registered Users",
    deepLink = "/movies",
  } = job.data;

  if (!broadcastId || !title || !message) {
    throw new Error("Missing required fields for broadcast job: broadcastId, title, or message");
  }

  // 1. Determine user query based on targetSegment
  const userFilter = { status: { $ne: "Deactivated" } };
  if (targetSegment === "Pro Plan Subscribers") {
    userFilter.membership = "pro";
  }

  const users = await User.find(userFilter).select("_id").lean();
  const totalUsers = users.length;

  if (totalUsers === 0) {
    return {
      success: true,
      broadcastId,
      totalUsers: 0,
      deliveredOnline: 0,
      storedOffline: 0,
    };
  }

  const dedupeKey = `broadcast:${broadcastId}`;
  let deliveredOnline = 0;
  let storedOffline = 0;

  // 2. Process in batches to optimize memory and MongoDB throughput
  for (let i = 0; i < totalUsers; i += BATCH_SIZE) {
    const userBatch = users.slice(i, i + BATCH_SIZE);
    const now = new Date();
    const batchNotifications = [];

    const bulkOps = userBatch.map((u) => {
      const notifId = new mongoose.Types.ObjectId();
      const userIdStr = String(u._id);
      const online = isUserOnline(userIdStr);

      batchNotifications.push({
        userId: userIdStr,
        notificationId: String(notifId),
        online,
      });

      return {
        updateOne: {
          filter: { user: u._id, dedupeKey },
          update: {
            $setOnInsert: {
              _id: notifId,
              user: u._id,
              type: "broadcast",
              title,
              message,
              amount: null,
              metadata: {
                broadcastId,
                channel,
                targetSegment,
                deepLink,
              },
              readAt: null,
              dedupeKey,
            },
          },
          upsert: true,
        },
      };
    });

    // Execute bulk upsert (idempotent; duplicate attempts will be no-ops)
    await Notification.bulkWrite(bulkOps, { ordered: false });

    // Fetch the actual notifications (in case of retries, ensure we have the real document ID)
    const existingNotifications = await Notification.find({
      user: { $in: userBatch.map((u) => u._id) },
      dedupeKey,
    })
      .select("_id user readAt createdAt")
      .lean();

    const notifMapByUserId = new Map();
    existingNotifications.forEach((n) => {
      notifMapByUserId.set(String(n.user), n);
    });

    // 3. Real-time delivery to online users
    for (const item of batchNotifications) {
      const actualNotif = notifMapByUserId.get(item.userId);
      const realId = actualNotif ? String(actualNotif._id) : item.notificationId;
      const createdAt = actualNotif?.createdAt || now;

      const payload = {
        id: realId,
        type: "broadcast",
        title,
        message,
        amount: null,
        metadata: {
          broadcastId,
          channel,
          targetSegment,
          deepLink,
        },
        readAt: null,
        createdAt: new Date(createdAt).toISOString(),
      };

      if (item.online) {
        emitUserNotification(item.userId, payload);
        deliveredOnline++;
      } else {
        storedOffline++;
      }
    }

    const progress = Math.min(Math.round(((i + userBatch.length) / totalUsers) * 100), 100);
    await job.updateProgress(progress);
  }

  try {
    await BroadcastCampaign.updateOne(
      { broadcastId },
      {
        $set: {
          status: "Delivered",
          sentCount: totalUsers,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error("Failed to update BroadcastCampaign status:", err.message);
  }

  return {
    success: true,
    broadcastId,
    totalUsers,
    deliveredOnline,
    storedOffline,
  };
};

export const initializeNotificationWorker = () => {
  if (broadcastWorker) {
    return broadcastWorker;
  }

  const connection = createBullRedisConnection("worker");
  broadcastWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      return await processBroadcastJob(job);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  broadcastWorker.on("completed", (job, result) => {
    console.log(
      `[BullMQ Worker] Job ${job.id} (Broadcast ${result?.broadcastId}) completed: ` +
        `Total: ${result?.totalUsers}, Online: ${result?.deliveredOnline}, Offline: ${result?.storedOffline}`
    );
  });

  broadcastWorker.on("failed", (job, error) => {
    console.error(`[BullMQ Worker] Job ${job?.id} failed:`, error.message);
  });

  broadcastWorker.on("error", (error) => {
    console.error(`[BullMQ Worker] Worker error:`, error.message);
  });

  return broadcastWorker;
};

export default initializeNotificationWorker;
