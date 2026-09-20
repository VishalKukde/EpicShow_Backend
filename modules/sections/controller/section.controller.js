import SectionSetting from "../model/SectionSetting.js";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  getSectionList,
  invalidateSectionCache,
} from "../service/section.service.js";

/** Public: used by the storefront to decide whether booking is open. */
export const getPublicSections = async (req, res) => {
  try {
    const sections = await getSectionList();
    return res.json({ sections });
  } catch (error) {
    console.error("getPublicSections error:", error);
    // Never block the storefront because settings could not be read.
    return res.json({
      sections: SECTION_KEYS.map((key) => ({
        key,
        label: SECTION_LABELS[key],
        bookingEnabled: true,
        message: "",
        updatedAt: null,
      })),
    });
  }
};

export const getAdminSections = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const sections = await getSectionList({ fresh: true });
    return res.json({ success: true, sections });
  } catch (error) {
    console.error("getAdminSections error:", error);
    return res.status(500).json({ message: "Failed to load section settings" });
  }
};

export const updateSection = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const key = String(req.params.key || "").toLowerCase();
    if (!SECTION_KEYS.includes(key)) {
      return res.status(400).json({ message: "Unknown section" });
    }

    const update = { updatedBy: req.user.id };
    if (typeof req.body?.bookingEnabled === "boolean") {
      update.bookingEnabled = req.body.bookingEnabled;
    }
    if (typeof req.body?.message === "string") {
      update.message = req.body.message.trim().slice(0, 300);
    }

    const doc = await SectionSetting.findOneAndUpdate(
      { key },
      { $set: update, $setOnInsert: { key } },
      { new: true, upsert: true }
    ).lean();

    invalidateSectionCache();

    return res.json({
      success: true,
      section: {
        key: doc.key,
        label: SECTION_LABELS[doc.key],
        bookingEnabled: doc.bookingEnabled !== false,
        message: doc.message || "",
        updatedAt: doc.updatedAt || null,
      },
    });
  } catch (error) {
    console.error("updateSection error:", error);
    return res.status(500).json({ message: "Failed to update section" });
  }
};
