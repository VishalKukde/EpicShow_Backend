import {
  DEFAULT_PLATFORM_SETTINGS,
  getPlatformSettings,
  savePlatformSettings,
} from "../service/platform.service.js";
import { emitPlatformSettings } from "../socket/platform.socket.js";

/** Public: the storefront reads the announcement and seat limits from here. */
export const getPublicPlatformSettings = async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    return res.json({ settings });
  } catch (error) {
    console.error("getPublicPlatformSettings error:", error);
    // Never block the storefront because settings could not be read.
    return res.json({ settings: { ...DEFAULT_PLATFORM_SETTINGS, updatedAt: null } });
  }
};

export const getAdminPlatformSettings = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const settings = await getPlatformSettings({ fresh: true });
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("getAdminPlatformSettings error:", error);
    return res.status(500).json({ message: "Failed to load platform settings" });
  }
};

export const updateAdminPlatformSettings = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const settings = await savePlatformSettings(req.body, req.user.id);

    // Push straight to every open storefront — no reload, no polling.
    emitPlatformSettings(settings);

    return res.json({ success: true, settings });
  } catch (error) {
    console.error("updateAdminPlatformSettings error:", error);
    return res.status(500).json({ message: "Failed to update platform settings" });
  }
};
