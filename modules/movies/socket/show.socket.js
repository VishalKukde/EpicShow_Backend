import crypto from "crypto";
import {
  getRedisClient,
  getRedisSubscriberClient,
} from "../../../config/redis.js";
import {
  buildShowId,
  buildShowRoom,
  buildSeatLockKey,
  parseSeatLockKey,
} from "../utils/show.utils.js";
import { getSeatLockScheduleKey, getSeatLockTtlSeconds } from "../services/seat-lock.service.js";

const SHOW_NAMESPACE = "/shows";
const REDIS_SEAT_EVENT_CHANNEL = "show-seat-events";
const SEAT_EVENT_POLL_INTERVAL_MS = 3000;
const EVENT_TTL_SECONDS = 24 * 60 * 60;

let showNamespace = null;
let seatEventBridgePromise = null;
let expiryPollingStarted = false;

const instanceId = crypto.randomUUID();

const getShowNamespace = () => showNamespace;

const emitLocally = (eventName, payload) => {
  if (!showNamespace) {
    return;
  }

  showNamespace.to(buildShowRoom(payload.showId)).emit(eventName, payload);
};

const publishSeatEvent = async (eventName, payload) => {
  const redis = await getRedisClient();
  await redis.publish(
    REDIS_SEAT_EVENT_CHANNEL,
    JSON.stringify({
      source: instanceId,
      eventName,
      payload,
    })
  );
};

const rememberEvent = async (eventName, payload) => {
  const redis = await getRedisClient();
  const dedupeKey = `seat:event:${eventName}:${payload.showId}:${(payload.seatIds || []).join(",")}:${payload.reason || "none"}`;

  return redis.set(dedupeKey, "1", {
    NX: true,
    EX: EVENT_TTL_SECONDS,
  });
};

const getRedisDbIndex = () => {
  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return 0;
    }

    const pathname = new URL(redisUrl).pathname || "";
    const parsed = Number.parseInt(pathname.replace("/", ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const maybeEnableKeyspaceNotifications = async (client) => {
  const config = await client.configGet("notify-keyspace-events");
  const currentValue = String(
    config instanceof Map
      ? config.get("notify-keyspace-events") || ""
      : config["notify-keyspace-events"] || ""
  );
  const desired = Array.from(new Set(`${currentValue}Ex`.split(""))).join("");

  if (desired !== currentValue) {
    await client.configSet("notify-keyspace-events", desired);
  }
};

const startExpiryPolling = async () => {
  if (expiryPollingStarted) {
    return;
  }

  expiryPollingStarted = true;

  const redis = await getRedisClient();
  const scheduleKey = getSeatLockScheduleKey();

  const poll = async () => {
    try {
      while (true) {
        const popped = await redis.zPopMin(scheduleKey);

        if (!popped?.value) {
          return;
        }

        const expiryScore = Number(popped.score);
        if (!Number.isFinite(expiryScore)) {
          continue;
        }

        if (expiryScore > Date.now()) {
          await redis.zAdd(scheduleKey, [{ score: expiryScore, value: popped.value }]);
          return;
        }

        const parsed = parseSeatLockKey(popped.value);
        if (!parsed) {
          continue;
        }

        const ttlSeconds = await getSeatLockTtlSeconds(parsed);

        if (ttlSeconds > 0) {
          await redis.zAdd(scheduleKey, [
            { score: Date.now() + ttlSeconds * 1000, value: popped.value },
          ]);
          continue;
        }

        const deduped = await rememberEvent("seat_unlocked", {
          showId: parsed.showId,
          seatIds: [parsed.seatId],
          reason: "expired",
        });

        if (deduped === "OK") {
          await broadcastShowSeatEvent("seat_unlocked", {
            showId: parsed.showId,
            seatIds: [parsed.seatId],
            reason: "expired",
          });
        }
      }
    } catch (error) {
      console.error("Seat expiry polling failed:", error);
    }
  };

  setInterval(() => {
    void poll();
  }, SEAT_EVENT_POLL_INTERVAL_MS);
};

const initializeExpiryListeners = async (subscriber) => {
  try {
    const redis = await getRedisClient();
    await maybeEnableKeyspaceNotifications(redis);
    const dbIndex = getRedisDbIndex();

    await subscriber.subscribe(`__keyevent@${dbIndex}__:expired`, async (message) => {
      const parsed = parseSeatLockKey(message);
      if (!parsed) {
        return;
      }

      const deduped = await rememberEvent("seat_unlocked", {
        showId: parsed.showId,
        seatIds: [parsed.seatId],
        reason: "expired",
      });

      if (deduped === "OK") {
        await broadcastShowSeatEvent("seat_unlocked", {
          showId: parsed.showId,
          seatIds: [parsed.seatId],
          reason: "expired",
        });
      }
    });
  } catch (error) {
    console.error("Keyspace notifications unavailable, falling back to polling:", error);
    await startExpiryPolling();
  }
};

const initializeSeatEventBridge = async () => {
  if (!seatEventBridgePromise) {
    seatEventBridgePromise = (async () => {
      const subscriber = await getRedisSubscriberClient();

      await subscriber.subscribe(REDIS_SEAT_EVENT_CHANNEL, (message) => {
        try {
          const parsed = JSON.parse(message);
          if (!parsed || parsed.source === instanceId) {
            return;
          }

          emitLocally(parsed.eventName, parsed.payload);
        } catch (error) {
          console.error("Failed to parse seat event payload:", error);
        }
      });

      await initializeExpiryListeners(subscriber);
    })().catch((error) => {
      seatEventBridgePromise = null;
      throw error;
    });
  }

  return seatEventBridgePromise;
};

export const initializeShowSocket = (io) => {
  showNamespace = io.of(SHOW_NAMESPACE);

  showNamespace.on("connection", (socket) => {
    socket.on("show:join", (payload = {}, ack) => {
      const itemId = payload?.itemId || payload?.movieId || payload?.eventId;
      const cinemaId = payload?.cinemaId || payload?.venueId;
      const showDate = payload?.showDate;
      const showSlot = payload?.showSlot;
      const showId = buildShowId({ itemId, cinemaId, showDate, showSlot });

      if (!showId) {
        if (typeof ack === "function") {
          ack({ ok: false, message: "Invalid show payload" });
        }
        return;
      }

      socket.join(buildShowRoom(showId));

      if (typeof ack === "function") {
        ack({ ok: true, showId });
      }
    });

    socket.on("show:leave", (payload = {}) => {
      const showId =
        typeof payload?.showId === "string" && payload.showId.trim()
          ? payload.showId.trim()
          : buildShowId({
              itemId: payload?.itemId || payload?.movieId || payload?.eventId,
              cinemaId: payload?.cinemaId || payload?.venueId,
              showDate: payload?.showDate,
              showSlot: payload?.showSlot,
            });
      if (!showId) {
        return;
      }

      socket.leave(buildShowRoom(showId));
    });
  });

  void initializeSeatEventBridge().catch((error) => {
    console.error("Failed to initialize show socket Redis bridge:", error);
  });
};

export const broadcastShowSeatEvent = async (eventName, payload) => {
  emitLocally(eventName, payload);
  await publishSeatEvent(eventName, payload);
};

export const emitSeatLocked = async (payload) => {
  await broadcastShowSeatEvent("seat_locked", payload);
};

export const emitSeatUnlocked = async (payload) => {
  await broadcastShowSeatEvent("seat_unlocked", payload);
};

export const emitSeatBooked = async (payload) => {
  const seatLockKeys = (payload.seatIds || []).map((seatId) =>
    buildSeatLockKey(payload.showId, seatId)
  );

  if (seatLockKeys.length > 0) {
    const redis = await getRedisClient();
    await redis.zRem(getSeatLockScheduleKey(), seatLockKeys);
  }

  await broadcastShowSeatEvent("seat_booked", payload);
};

export const getShowSocketNamespace = getShowNamespace;
