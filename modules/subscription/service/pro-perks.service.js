const FREE_TICKET_LIMIT = 2;
const PRO_TICKET_LIMIT = 5;
const FREE_SEAT_LOCK_SECONDS = 5 * 60;
const PRO_SEAT_LOCK_SECONDS = 10 * 60;
const PRO_REWARD_MULTIPLIER = 2;

export const isProMembership = (membership) => membership === "pro";

export const getTicketLimitForMembership = (membership) =>
  isProMembership(membership) ? PRO_TICKET_LIMIT : FREE_TICKET_LIMIT;

export const getSeatLockTtlSecondsForMembership = (membership) =>
  isProMembership(membership) ? PRO_SEAT_LOCK_SECONDS : FREE_SEAT_LOCK_SECONDS;

export const getRewardEarnRateForMembership = (baseRate, membership) =>
  Number(baseRate) * (isProMembership(membership) ? PRO_REWARD_MULTIPLIER : 1);

export const assertTicketLimitForMembership = (seatIds = [], membership) => {
  const ticketLimit = getTicketLimitForMembership(membership);
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
