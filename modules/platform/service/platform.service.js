import PlatformSetting from "../model/PlatformSetting.js";

export const PLATFORM_KEY = "platform";

export const DEFAULT_PLATFORM_SETTINGS = {
  ticketLimits: { free: 2, pro: 5 },
  seatHoldSeconds: { free: 300, pro: 600 },
  rewards: { earnRate: 0.1, proMultiplier: 2 },
  announcement: { enabled: false, message: "", tone: "info" },
  registrationEnabled: true,
};

const TICKET_LIMIT_MIN = 1;
const TICKET_LIMIT_MAX = 20;
const SEAT_HOLD_MIN = 60;
const SEAT_HOLD_MAX = 3600;
const EARN_RATE_MAX = 1;
const PRO_MULTIPLIER_MIN = 1;
const PRO_MULTIPLIER_MAX = 10;
const ANNOUNCEMENT_MAX = 300;
const TONES = ["info", "warning", "success"];

// Small cache so booking guards don't hit MongoDB on every request.
const CACHE_TTL_MS = 10_000;
let cache = { at: 0, value: null };

export const invalidatePlatformCache = () => {
  cache = { at: 0, value: null };
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
};

const clampFloat = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const clampLimit = (value, fallback) =>
  clampInt(value, fallback, TICKET_LIMIT_MIN, TICKET_LIMIT_MAX);

const clampHold = (value, fallback) =>
  clampInt(value, fallback, SEAT_HOLD_MIN, SEAT_HOLD_MAX);

/** Shapes a document (or nothing) into the full settings object. */
const normalize = (doc) => ({
  ticketLimits: {
    free: clampLimit(doc?.ticketLimits?.free, DEFAULT_PLATFORM_SETTINGS.ticketLimits.free),
    pro: clampLimit(doc?.ticketLimits?.pro, DEFAULT_PLATFORM_SETTINGS.ticketLimits.pro),
  },
  seatHoldSeconds: {
    free: clampHold(doc?.seatHoldSeconds?.free, DEFAULT_PLATFORM_SETTINGS.seatHoldSeconds.free),
    pro: clampHold(doc?.seatHoldSeconds?.pro, DEFAULT_PLATFORM_SETTINGS.seatHoldSeconds.pro),
  },
  rewards: {
    earnRate: clampFloat(doc?.rewards?.earnRate, DEFAULT_PLATFORM_SETTINGS.rewards.earnRate, 0, EARN_RATE_MAX),
    proMultiplier: clampFloat(
      doc?.rewards?.proMultiplier,
      DEFAULT_PLATFORM_SETTINGS.rewards.proMultiplier,
      PRO_MULTIPLIER_MIN,
      PRO_MULTIPLIER_MAX
    ),
  },
  announcement: {
    enabled: doc?.announcement?.enabled === true,
    message: doc?.announcement?.message || "",
    tone: TONES.includes(doc?.announcement?.tone) ? doc.announcement.tone : "info",
  },
  registrationEnabled: doc?.registrationEnabled !== false,
  updatedAt: doc?.updatedAt || null,
});

export const getPlatformSettings = async ({ fresh = false } = {}) => {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const doc = await PlatformSetting.findOne({ key: PLATFORM_KEY }).lean();
  const value = normalize(doc);
  cache = { at: Date.now(), value };
  return value;
};

/** Seats a member of this tier may hold in one booking. */
export const getTicketLimitFor = async (membership) => {
  const settings = await getPlatformSettings();
  return membership === "pro" ? settings.ticketLimits.pro : settings.ticketLimits.free;
};

/** How long this tier's cart holds its seats, in seconds. */
export const getSeatHoldSecondsFor = async (membership) => {
  const settings = await getPlatformSettings();
  return membership === "pro" ? settings.seatHoldSeconds.pro : settings.seatHoldSeconds.free;
};

/** Points earned per rupee for this tier, Pro multiplier already applied. */
export const getRewardEarnRateFor = async (membership) => {
  const settings = await getPlatformSettings();
  const { earnRate, proMultiplier } = settings.rewards;
  return membership === "pro" ? earnRate * proMultiplier : earnRate;
};

export const isRegistrationEnabled = async () => {
  const settings = await getPlatformSettings();
  return settings.registrationEnabled;
};

/** Validates and applies a partial update, returning the new settings. */
export const savePlatformSettings = async (body, adminId) => {
  const current = await getPlatformSettings({ fresh: true });
  const update = { updatedBy: adminId || null };

  if (body?.ticketLimits) {
    update.ticketLimits = {
      free: clampLimit(body.ticketLimits.free, current.ticketLimits.free),
      pro: clampLimit(body.ticketLimits.pro, current.ticketLimits.pro),
    };
  }

  if (body?.seatHoldSeconds) {
    update.seatHoldSeconds = {
      free: clampHold(body.seatHoldSeconds.free, current.seatHoldSeconds.free),
      pro: clampHold(body.seatHoldSeconds.pro, current.seatHoldSeconds.pro),
    };
  }

  if (body?.rewards) {
    update.rewards = {
      earnRate: clampFloat(body.rewards.earnRate, current.rewards.earnRate, 0, EARN_RATE_MAX),
      proMultiplier: clampFloat(
        body.rewards.proMultiplier,
        current.rewards.proMultiplier,
        PRO_MULTIPLIER_MIN,
        PRO_MULTIPLIER_MAX
      ),
    };
  }

  if (body?.announcement) {
    const next = { ...current.announcement };
    if (typeof body.announcement.enabled === "boolean") next.enabled = body.announcement.enabled;
    if (typeof body.announcement.message === "string") {
      next.message = body.announcement.message.trim().slice(0, ANNOUNCEMENT_MAX);
    }
    if (TONES.includes(body.announcement.tone)) next.tone = body.announcement.tone;
    update.announcement = next;
  }

  if (typeof body?.registrationEnabled === "boolean") {
    update.registrationEnabled = body.registrationEnabled;
  }

  const doc = await PlatformSetting.findOneAndUpdate(
    { key: PLATFORM_KEY },
    { $set: update, $setOnInsert: { key: PLATFORM_KEY } },
    { new: true, upsert: true }
  ).lean();

  invalidatePlatformCache();
  const value = normalize(doc);
  cache = { at: Date.now(), value };
  return value;
};
