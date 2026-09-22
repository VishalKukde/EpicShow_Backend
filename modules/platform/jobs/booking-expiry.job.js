import Booking from "../../movies/models/Booking.js";
import SportBooking from "../../sports/models/Booking.js";
import TrainBooking from "../../trains/models/TrainBooking.js";
import Payment from "../../movies/models/Payment.js";
import { getPlatformSettings } from "../service/platform.service.js";

/**
 * Expires checkouts that were never paid for.
 *
 * Picking seats creates a `pending` booking. The Redis seat lock releases
 * itself after the hold window, but nothing used to close the booking document
 * — so a customer who backed out left a `pending` row forever, inflating
 * booking counts and never matching the order count.
 *
 * This marks those rows `expired` once the hold can no longer be alive.
 */

const RUN_EVERY_MS = 2 * 60 * 1000;

/**
 * Grace on top of the hold window.
 *
 * The job deliberately runs late rather than early: expiring a checkout that
 * is still in progress would be far worse than expiring one a few minutes
 * after it died.
 */
const GRACE_SECONDS = 120;

const COLLECTIONS = [
  { name: "bookings", model: Booking },
  { name: "sportbookings", model: SportBooking },
  { name: "trainbookings", model: TrainBooking },
];

let intervalId = null;
let isRunning = false;

/**
 * Seat holds vary by tier, so the cutoff uses the longest configured hold.
 * A free member's dead checkout simply survives a few extra minutes.
 */
export async function resolveAbandonedCutoff() {
  const settings = await getPlatformSettings();
  const longestHold = Math.max(settings.seatHoldSeconds.free, settings.seatHoldSeconds.pro);
  const staleAfterSeconds = longestHold + GRACE_SECONDS;
  return {
    cutoff: new Date(Date.now() - staleAfterSeconds * 1000),
    staleAfterMinutes: Math.round(staleAfterSeconds / 60),
  };
}

export async function expireStaleBookings() {
  const { cutoff } = await resolveAbandonedCutoff();
  let expiredCount = 0;

  for (const { model } of COLLECTIONS) {
    const candidates = await model
      .find({ status: "pending", createdAt: { $lte: cutoff } })
      .select("_id")
      .lean();

    if (candidates.length === 0) continue;

    const ids = candidates.map((doc) => doc._id);

    // A payment may have succeeded moments before this ran; never expire those.
    const paid = await Payment.find({ bookingId: { $in: ids }, status: "success" })
      .select("bookingId")
      .lean();
    const paidIds = new Set(paid.map((doc) => String(doc.bookingId)));

    const toExpire = ids.filter((id) => !paidIds.has(String(id)));
    if (toExpire.length === 0) continue;

    const result = await model.updateMany(
      { _id: { $in: toExpire }, status: "pending" },
      { $set: { status: "expired" } }
    );

    expiredCount += result.modifiedCount || 0;
  }

  return { expiredCount, cutoff };
}

async function runExpiryJob() {
  if (isRunning) return;

  isRunning = true;
  try {
    const { expiredCount } = await expireStaleBookings();
    if (expiredCount > 0) {
      console.log(`Booking expiry job: expired ${expiredCount} abandoned checkout(s)`);
    }
  } catch (error) {
    console.error("Booking expiry job failed:", error);
  } finally {
    isRunning = false;
  }
}

export function startBookingExpiryJob() {
  if (intervalId) return intervalId;

  runExpiryJob();
  intervalId = setInterval(runExpiryJob, RUN_EVERY_MS);

  return intervalId;
}
