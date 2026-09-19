import { Queue } from "bullmq";
import { createBullRedisConnection } from "../../../config/bullmq.js";

const QUEUE_NAME = "broadcast-notifications";

let broadcastQueue = null;

export const getBroadcastQueue = () => {
  if (!broadcastQueue) {
    const connection = createBullRedisConnection("queue");
    broadcastQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });

    broadcastQueue.on("error", (err) => {
      console.error(`[BullMQ Queue ${QUEUE_NAME}] error:`, err);
    });
  }

  return broadcastQueue;
};

export const addBroadcastNotificationJob = async ({
  broadcastId,
  title,
  message,
  channel = "Push Notification",
  targetSegment = "All Registered Users",
  deepLink = "/movies",
  adminId = null,
}) => {
  const queue = getBroadcastQueue();

  const jobData = {
    broadcastId,
    title,
    message,
    channel,
    targetSegment,
    deepLink,
    adminId,
    dispatchedAt: new Date().toISOString(),
  };

  const job = await queue.add("dispatch-broadcast", jobData, {
    jobId: `broadcast_${broadcastId}`, // Deduplicates if re-submitted
  });

  return job;
};

export default getBroadcastQueue;
