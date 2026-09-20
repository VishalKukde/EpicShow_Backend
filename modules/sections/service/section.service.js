import SectionSetting from "../model/SectionSetting.js";

/** Sections an admin can switch off. */
export const SECTION_KEYS = ["movies", "sports", "trains", "gaming"];

export const SECTION_LABELS = {
  movies: "Movies",
  sports: "Sports",
  trains: "Trains",
  gaming: "Gaming",
};

export const DEFAULT_DISABLED_MESSAGE =
  "Booking for this section isn't open right now. Please check back soon.";

// Small cache so the booking guards don't hit MongoDB on every request.
const CACHE_TTL_MS = 10_000;
let cache = { at: 0, map: null };

export const invalidateSectionCache = () => {
  cache = { at: 0, map: null };
};

const toMap = (docs) => {
  const map = new Map();
  SECTION_KEYS.forEach((key) => {
    map.set(key, { key, bookingEnabled: true, message: "", updatedAt: null });
  });
  docs.forEach((doc) => {
    if (!SECTION_KEYS.includes(doc.key)) return;
    map.set(doc.key, {
      key: doc.key,
      bookingEnabled: doc.bookingEnabled !== false,
      message: doc.message || "",
      updatedAt: doc.updatedAt || null,
    });
  });
  return map;
};

/** All sections, defaults filled in for any that were never saved. */
export const getSectionMap = async ({ fresh = false } = {}) => {
  if (!fresh && cache.map && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.map;
  }

  const docs = await SectionSetting.find({ key: { $in: SECTION_KEYS } }).lean();
  const map = toMap(docs);
  cache = { at: Date.now(), map };
  return map;
};

export const getSectionList = async (options) => {
  const map = await getSectionMap(options);
  return SECTION_KEYS.map((key) => ({
    ...map.get(key),
    label: SECTION_LABELS[key],
  }));
};

export const isSectionBookingEnabled = async (key) => {
  const map = await getSectionMap();
  return map.get(key)?.bookingEnabled !== false;
};

export const getSectionMessage = async (key) => {
  const map = await getSectionMap();
  return map.get(key)?.message || DEFAULT_DISABLED_MESSAGE;
};
