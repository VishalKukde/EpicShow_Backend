import mongoose from "mongoose";

const DEFAULT_LOCK_TTL_SECONDS = 5 * 60;
const MIN_LOCK_TTL_SECONDS = 5 * 60;
const MAX_LOCK_TTL_SECONDS = 10 * 60;

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

export const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

export const toIdString = (value) => (value ? String(value).trim() : "");

export const toObjectId = (value) => {
  const id = toIdString(value);
  if (!mongoose.isValidObjectId(id)) {
    return null;
  }

  return new mongoose.Types.ObjectId(id);
};

export const resolveSeatLockTtlSeconds = () => {
  const parsed = Number.parseInt(String(process.env.SEAT_LOCK_TTL_SECONDS || ""), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LOCK_TTL_SECONDS;
  }

  return clampNumber(parsed, MIN_LOCK_TTL_SECONDS, MAX_LOCK_TTL_SECONDS);
};

export const buildShowId = ({ itemId, cinemaId, showDate, showSlot }) => {
  const normalizedItemId = toIdString(itemId);
  const normalizedCinemaId = normalizeString(cinemaId);
  const normalizedShowDate = normalizeString(showDate);
  const normalizedShowSlot = normalizeString(showSlot);

  if (!normalizedItemId || !normalizedCinemaId || !normalizedShowDate || !normalizedShowSlot) {
    return "";
  }

  return [
    normalizedItemId,
    normalizedCinemaId,
    normalizedShowDate,
    encodeURIComponent(normalizedShowSlot),
  ].join("|");
};

export const buildShowRoom = (showId) => `show:${showId}`;

export const buildSeatLockKey = (showId, seatId) =>
  `seat:${showId}:${normalizeString(seatId)}`;

export const buildShowSessionKey = (showId, userId) =>
  `seat_session:${showId}:${toIdString(userId)}`;

export const buildPaymentIdempotencyLockKey = (idempotencyKey) =>
  `payment:idempotency:${idempotencyKey}:lock`;

export const buildPaymentIdempotencyResultKey = (idempotencyKey) =>
  `payment:idempotency:${idempotencyKey}:result`;

export const parseSeatLockKey = (key) => {
  const normalizedKey = normalizeString(key);
  const match = normalizedKey.match(/^seat:([^:]+):([^:]+)$/);

  if (!match) {
    return null;
  }

  return {
    showId: match[1],
    seatId: match[2],
  };
};
