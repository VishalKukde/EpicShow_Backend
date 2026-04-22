import { getRedisClient } from "../../../config/redis.js";
import {
  buildSeatLockKey,
  buildShowSessionKey,
  resolveSeatLockTtlSeconds,
  toIdString,
} from "../utils/show.utils.js";

const LOCK_SCHEDULE_KEY = "seat_lock_expirations";

const RELEASE_IF_OWNER_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    redis.call("del", KEYS[1])
    redis.call("zrem", KEYS[2], KEYS[1])
    return 1
  end
  return 0
`;

const FALLBACK_REMOVE_SCRIPT = `
  redis.call("del", KEYS[1])
  redis.call("zrem", KEYS[2], KEYS[1])
  return 1
`;

const normalizeTtlSeconds = (ttl) => {
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return resolveSeatLockTtlSeconds();
  }

  return Math.floor(ttl);
};

const getSeatKeys = (showId, seatIds = []) =>
  seatIds.map((seatId) => buildSeatLockKey(showId, seatId));

export const getSeatLockScheduleKey = () => LOCK_SCHEDULE_KEY;

export const resolveShowLockTtlSeconds = async ({ showId, userId }) => {
  const redis = await getRedisClient();
  const sessionKey = buildShowSessionKey(showId, userId);

  let ttlSeconds = await redis.ttl(sessionKey);

  if (ttlSeconds <= 0) {
    await redis.set(sessionKey, toIdString(userId), {
      NX: true,
      EX: resolveSeatLockTtlSeconds(),
    });
    ttlSeconds = await redis.ttl(sessionKey);
  }

  return normalizeTtlSeconds(ttlSeconds);
};

export const acquireSeatLock = async ({ showId, seatId, userId }) => {
  const redis = await getRedisClient();
  const normalizedUserId = toIdString(userId);
  const seatKey = buildSeatLockKey(showId, seatId);
  const ttlSeconds = await resolveShowLockTtlSeconds({ showId, userId: normalizedUserId });

  const lockResult = await redis.set(seatKey, normalizedUserId, {
    NX: true,
    EX: ttlSeconds,
  });

  if (lockResult === "OK") {
    const expireAt = Date.now() + ttlSeconds * 1000;
    await redis.zAdd(LOCK_SCHEDULE_KEY, [{ score: expireAt, value: seatKey }]);

    return {
      acquired: true,
      expireAt: new Date(expireAt).toISOString(),
      ttlSeconds,
      lockOwner: normalizedUserId,
    };
  }

  const [lockOwner, currentTtl] = await Promise.all([redis.get(seatKey), redis.ttl(seatKey)]);

  if (lockOwner === normalizedUserId) {
    const effectiveTtl = normalizeTtlSeconds(currentTtl);
    return {
      acquired: true,
      expireAt: new Date(Date.now() + effectiveTtl * 1000).toISOString(),
      ttlSeconds: effectiveTtl,
      lockOwner,
      alreadyHeld: true,
    };
  }

  return {
    acquired: false,
    lockOwner,
    ttlSeconds: normalizeTtlSeconds(currentTtl),
  };
};

export const releaseSeatLock = async ({ showId, seatId, userId }) => {
  const redis = await getRedisClient();
  const seatKey = buildSeatLockKey(showId, seatId);
  const removed = await redis.eval(RELEASE_IF_OWNER_SCRIPT, {
    keys: [seatKey, LOCK_SCHEDULE_KEY],
    arguments: [toIdString(userId)],
  });

  return Number(removed) === 1;
};

export const releaseSeatLocks = async ({ showId, seatIds = [], userId }) => {
  const results = await Promise.all(
    seatIds.map((seatId) =>
      releaseSeatLock({
        showId,
        seatId,
        userId,
      })
    )
  );

  return seatIds.filter((seatId, index) => results[index]);
};

export const forceReleaseSeatLocks = async ({ showId, seatIds = [] }) => {
  const redis = await getRedisClient();
  const seatKeys = getSeatKeys(showId, seatIds);

  if (seatKeys.length === 0) {
    return 0;
  }

  const results = await Promise.all(
    seatKeys.map((seatKey) =>
      redis.eval(FALLBACK_REMOVE_SCRIPT, {
        keys: [seatKey, LOCK_SCHEDULE_KEY],
        arguments: [],
      })
    )
  );

  return results.filter((value) => Number(value) === 1).length;
};

export const getSeatLockOwners = async ({ showId, seatIds = [] }) => {
  const redis = await getRedisClient();
  const seatKeys = getSeatKeys(showId, seatIds);

  if (seatKeys.length === 0) {
    return new Map();
  }

  const values = await redis.mGet(seatKeys);

  return seatIds.reduce((accumulator, seatId, index) => {
    accumulator.set(String(seatId), values[index] || null);
    return accumulator;
  }, new Map());
};

export const getSeatLockOwner = async ({ showId, seatId }) => {
  const redis = await getRedisClient();
  return redis.get(buildSeatLockKey(showId, seatId));
};

export const getSeatLockTtlSeconds = async ({ showId, seatId }) => {
  const redis = await getRedisClient();
  return redis.ttl(buildSeatLockKey(showId, seatId));
};

export const assertSeatLocksOwnedByUser = async ({ showId, seatIds = [], userId }) => {
  const normalizedUserId = toIdString(userId);
  const owners = await getSeatLockOwners({ showId, seatIds });
  const invalidSeatIds = seatIds.filter((seatId) => owners.get(String(seatId)) !== normalizedUserId);

  return {
    valid: invalidSeatIds.length === 0,
    invalidSeatIds,
    owners,
  };
};
