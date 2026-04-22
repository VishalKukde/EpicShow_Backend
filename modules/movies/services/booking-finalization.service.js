import BookedSeat from "../models/BookedSeat.js";
import { getRedisClient } from "../../../config/redis.js";
import { emitSeatBooked } from "../socket/show.socket.js";
import {
  assertSeatLocksOwnedByUser,
  forceReleaseSeatLocks,
} from "./seat-lock.service.js";
import {
  buildPaymentIdempotencyLockKey,
  buildPaymentIdempotencyResultKey,
  buildShowId,
  normalizeString,
  toIdString,
} from "../utils/show.utils.js";

const PAYMENT_RESULT_TTL_SECONDS = 24 * 60 * 60;
const PAYMENT_LOCK_TTL_SECONDS = 90;

const duplicateSeatError = Object.assign(
  new Error("Seat no longer available"),
  { statusCode: 409 }
);

export const resolveBookingShowId = (booking = {}) =>
  buildShowId({
    itemId: booking.itemId,
    cinemaId: booking.cinemaId,
    showDate: booking.date,
    showSlot: booking.slot,
  });

export const findBookedSeats = async ({ showId, seatIds = [], session = null }) => {
  const query = BookedSeat.find({
    showId,
    seatId: { $in: seatIds },
  }).select("seatId");

  if (session) {
    query.session(session);
  }

  return query.lean();
};

export const ensureSeatsNotBooked = async ({ showId, seatIds = [], session = null }) => {
  const existingBookedSeats = await findBookedSeats({ showId, seatIds, session });

  return {
    available: existingBookedSeats.length === 0,
    existingBookedSeatIds: existingBookedSeats.map((seat) => seat.seatId),
  };
};

export const assertBookingLocksAreStillValid = async (booking) => {
  const showId = booking.showId || resolveBookingShowId(booking);
  const { valid, invalidSeatIds } = await assertSeatLocksOwnedByUser({
    showId,
    seatIds: booking.seatIds || [],
    userId: booking.userId,
  });

  return {
    valid,
    invalidSeatIds,
    showId,
  };
};

export const createBookedSeatsForBooking = async ({
  booking,
  paymentId = null,
  showType = "movie",
  session,
}) => {
  const showId = booking.showId || resolveBookingShowId(booking);
  const documents = (booking.seatIds || []).map((seatId) => ({
    bookingId: booking._id,
    userId: toIdString(booking.userId),
    showType: normalizeString(showType || booking.showType || "movie"),
    showId,
    itemId: toIdString(booking.itemId),
    cinemaId: normalizeString(booking.cinemaId),
    showDate: normalizeString(booking.date),
    showSlot: normalizeString(booking.slot),
    seatId: normalizeString(seatId),
    paymentId: paymentId ? String(paymentId) : null,
  }));

  try {
    await BookedSeat.insertMany(documents, {
      session,
      ordered: true,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw duplicateSeatError;
    }

    throw error;
  }

  return showId;
};

export const finalizeSeatLocksAfterBooking = async ({ showId, seatIds = [], bookingId, userId }) => {
  await forceReleaseSeatLocks({ showId, seatIds });
  await emitSeatBooked({
    showId,
    seatIds,
    bookingId: String(bookingId),
    userId: toIdString(userId),
  });
};

export const withPaymentIdempotency = async ({ idempotencyKey, onConflict, handler }) => {
  const redis = await getRedisClient();
  const lockKey = buildPaymentIdempotencyLockKey(idempotencyKey);
  const resultKey = buildPaymentIdempotencyResultKey(idempotencyKey);

  const cached = await redis.get(resultKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const acquired = await redis.set(lockKey, "1", {
    NX: true,
    EX: PAYMENT_LOCK_TTL_SECONDS,
  });

  if (acquired !== "OK") {
    const afterLockCache = await redis.get(resultKey);
    if (afterLockCache) {
      return JSON.parse(afterLockCache);
    }

    if (typeof onConflict === "function") {
      return onConflict();
    }

    const error = new Error("Payment is already being processed");
    error.statusCode = 409;
    throw error;
  }

  try {
    const result = await handler();
    await redis.set(resultKey, JSON.stringify(result), {
      EX: PAYMENT_RESULT_TTL_SECONDS,
    });
    return result;
  } finally {
    await redis.del(lockKey);
  }
};
