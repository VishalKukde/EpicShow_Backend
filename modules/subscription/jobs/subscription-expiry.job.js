import { expireSubscriptions } from "../service/subscription.service.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
let intervalId = null;
let isRunning = false;

async function runExpiryJob() {
  if (isRunning) return;

  isRunning = true;
  try {
    const result = await expireSubscriptions();
    if (result.expiredCount > 0) {
      console.log(
        `Subscription expiry job: expired ${result.expiredCount}, synced ${result.syncedUsers}`
      );
    }
  } catch (error) {
    console.error("Subscription expiry job failed:", error);
  } finally {
    isRunning = false;
  }
}

export function startSubscriptionExpiryJob() {
  if (intervalId) return intervalId;

  runExpiryJob();
  intervalId = setInterval(runExpiryJob, ONE_HOUR_MS);

  return intervalId;
}
