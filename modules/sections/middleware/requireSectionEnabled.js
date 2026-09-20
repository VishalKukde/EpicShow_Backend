import {
  DEFAULT_DISABLED_MESSAGE,
  getSectionMap,
} from "../service/section.service.js";

/**
 * Blocks booking/payment endpoints while an admin has that section switched off.
 * Usage: router.post("/payment/prepare", authMiddleware, requireSectionEnabled("movies"), handler)
 */
export const requireSectionEnabled = (key) => async (req, res, next) => {
  try {
    const map = await getSectionMap();
    const section = map.get(key);

    if (section && section.bookingEnabled === false) {
      return res.status(403).json({
        message: section.message || DEFAULT_DISABLED_MESSAGE,
        sectionDisabled: true,
        section: key,
      });
    }

    return next();
  } catch (error) {
    // Settings lookup failing must not take booking down.
    console.error(`requireSectionEnabled(${key}) error:`, error.message);
    return next();
  }
};

export default requireSectionEnabled;
