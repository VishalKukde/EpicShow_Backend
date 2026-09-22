import {
  getRewardEarnRateFor,
  getSeatHoldSecondsFor,
  getTicketLimitFor,
} from "../../platform/service/platform.service.js";

/**
 * Membership perks.
 *
 * These used to be hardcoded constants here, which meant the Portal Settings
 * seat limit was advertised to the browser but never enforced at payment. They
 * now read the admin-configured platform settings (which fall back to the same
 * defaults: 2/5 seats, 5/10 minute holds, 0.1 points per rupee, 2x for Pro).
 *
 * The getters are async because settings live in MongoDB behind a short cache.
 */

export const isProMembership = (membership) => membership === "pro";

export const getTicketLimitForMembership = (membership) => getTicketLimitFor(membership);

export const getSeatLockTtlSecondsForMembership = (membership) =>
  getSeatHoldSecondsFor(membership);

/**
 * Points earned per rupee, Pro multiplier applied.
 *
 * `baseRate` is accepted for the existing call sites but ignored — the rate is
 * an admin setting now, so a caller cannot quietly diverge from it.
 */
export const getRewardEarnRateForMembership = (_baseRate, membership) =>
  getRewardEarnRateFor(membership);

export const assertTicketLimitForMembership = async (seatIds = [], membership) => {
  const ticketLimit = await getTicketLimitFor(membership);
  const selectedCount = Array.isArray(seatIds) ? seatIds.length : 0;

  if (selectedCount > ticketLimit) {
    const error = new Error(
      `You can book up to ${ticketLimit} tickets with your current plan`
    );
    error.statusCode = 400;
    throw error;
  }

  return ticketLimit;
};
