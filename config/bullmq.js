import "dotenv/config";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

export const createBullRedisConnection = (name = "bullmq") => {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL environment variable is not defined");
  }

  const client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
  });

  client.on("error", (error) => {
    console.error(`[BullMQ Redis ${name}] error:`, error.message);
  });

  return client;
};

export default createBullRedisConnection;
