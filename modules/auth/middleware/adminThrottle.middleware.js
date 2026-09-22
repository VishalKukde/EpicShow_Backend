import { getClientIp } from "../../../utils/parseUserAgent.js";

/**
 * Request throttle for the admin authentication endpoints.
 *
 * The TOTP lockout in the controller only engages once the email and password
 * are already correct, so on its own it does nothing to slow password guessing.
 * This caps attempts per caller before any credential is checked.
 *
 * State is per-process and in memory: behind several instances a determined
 * attacker gets one bucket per instance. It is a speed bump, not a substitute
 * for an edge rate limit, but it closes the unbounded case.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

/** key -> timestamps of the attempts still inside the current window */
const attempts = new Map();

let lastSweep = 0;

/** Drops buckets nobody has touched for a full window. */
function sweep(now) {
    for (const [key, stamps] of attempts) {
        const live = stamps.filter((at) => now - at < WINDOW_MS);
        if (live.length === 0) attempts.delete(key);
        else attempts.set(key, live);
    }
}

export function adminAuthThrottle(req, res, next) {
    const now = Date.now();

    // Sweeping on a timer rather than per request keeps this cheap in the common
    // case while stopping the map growing without bound across rotating IPs.
    if (now - lastSweep > WINDOW_MS) {
        sweep(now);
        lastSweep = now;
    }

    // Keyed on the IP and the claimed email together, so an attacker cannot lock
    // a real admin out of their own account by hammering it from somewhere else.
    const email = String(req.body?.email || "").trim().toLowerCase();
    const key = `${getClientIp(req)}|${email}`;

    const recent = (attempts.get(key) || []).filter((at) => now - at < WINDOW_MS);

    if (recent.length >= MAX_ATTEMPTS) {
        const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
        res.set("Retry-After", String(retryAfterSeconds));

        return res.status(429).json({
            message: "Too many attempts. Please wait a few minutes and try again.",
        });
    }

    recent.push(now);
    attempts.set(key, recent);

    return next();
}

/** Clears the bucket once a caller has proved who they are. */
export function clearAdminThrottle(req) {
    const email = String(req.body?.email || "").trim().toLowerCase();
    attempts.delete(`${getClientIp(req)}|${email}`);
}
