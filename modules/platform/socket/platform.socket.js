import { getPlatformSettings } from "../service/platform.service.js";

const PLATFORM_NAMESPACE = "/platform";
const SETTINGS_EVENT = "platform:settings";

let platformNamespace = null;

/**
 * Pushes platform settings to every connected storefront.
 *
 * Unauthenticated on purpose: the announcement has to reach logged-out
 * visitors too, and nothing here is user-specific or sensitive.
 */
export const initializePlatformSocket = (io) => {
  platformNamespace = io.of(PLATFORM_NAMESPACE);

  platformNamespace.on("connection", async (socket) => {
    // Send current settings on connect so a late joiner is never stale.
    try {
      const settings = await getPlatformSettings();
      socket.emit(SETTINGS_EVENT, settings);
    } catch {
      // A failed read should not break the connection; the client keeps
      // whatever it fetched over HTTP.
    }
  });
};

/** Broadcasts a saved settings object to all connected clients. */
export const emitPlatformSettings = (settings) => {
  if (!platformNamespace || !settings) return;
  platformNamespace.emit(SETTINGS_EVENT, settings);
};
