/**
 * True wall-clock time, independent of this host's clock.
 *
 * TOTP is purely time-based, so a server whose clock is off by more than one
 * 30s step can never agree with an authenticator app. This machine runs ~55s
 * fast because it syncs from a domain time source that is itself wrong, which
 * is not something the application can fix — so TOTP uses a corrected clock
 * instead of the host one.
 *
 * The offset is measured against public HTTPS `Date` headers, which are plain
 * UTC to the second. That is far coarser than NTP and entirely adequate here,
 * where the tolerance is a 30-second window.
 */

/** trueEpoch = hostEpoch + offsetSeconds */
let offsetSeconds = 0;
let lastCalibratedAt = 0;
let calibrating = null;

const REFRESH_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

/** Sampled together so one unreachable host cannot skew the result. */
const TIME_SOURCES = ["https://www.cloudflare.com", "https://www.google.com"];

function manualOffset() {
    const raw = process.env.TOTP_TIME_OFFSET_SECONDS;
    if (raw === undefined || raw === "") return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Offset from one source, or null if it could not be read. */
async function sample(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const before = Date.now();
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        const after = Date.now();

        const header = res.headers.get("date");
        if (!header) return null;

        const remoteMs = Date.parse(header);
        if (Number.isNaN(remoteMs)) return null;

        // Compare against the midpoint of the request, so the round trip is
        // split evenly rather than counted against one side.
        const localMs = (before + after) / 2;
        return Math.round((remoteMs - localMs) / 1000);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Re-measures the offset. Safe to call often — it is throttled, and concurrent
 * callers share one in-flight measurement.
 */
export async function calibrate({ force = false } = {}) {
    const manual = manualOffset();
    if (manual !== null) {
        offsetSeconds = manual;
        lastCalibratedAt = Date.now();
        return offsetSeconds;
    }

    if (!force && Date.now() - lastCalibratedAt < REFRESH_MS) return offsetSeconds;
    if (calibrating) return calibrating;

    calibrating = (async () => {
        const samples = (await Promise.all(TIME_SOURCES.map(sample))).filter(
            (value) => value !== null
        );

        if (samples.length > 0) {
            samples.sort((a, b) => a - b);
            const median = samples[Math.floor(samples.length / 2)];

            if (median !== offsetSeconds) {
                console.log(
                    `[trusted-time] host clock is ${-median >= 0 ? "+" : ""}${-median}s vs real time; ` +
                    `TOTP will correct by ${median >= 0 ? "+" : ""}${median}s`
                );
            }

            offsetSeconds = median;
            lastCalibratedAt = Date.now();
        } else if (lastCalibratedAt === 0) {
            // Never calibrated and the network is unavailable: fall back to the
            // host clock rather than blocking sign-in entirely.
            console.warn("[trusted-time] could not reach a time source; using this host's clock");
            lastCalibratedAt = Date.now();
        }

        calibrating = null;
        return offsetSeconds;
    })();

    return calibrating;
}

/** Unix seconds, corrected for this host's clock error. */
export function trustedEpochSeconds() {
    // Refresh in the background; callers always get the current best estimate.
    if (Date.now() - lastCalibratedAt >= REFRESH_MS) {
        calibrate().catch(() => { });
    }

    return Math.floor(Date.now() / 1000) + offsetSeconds;
}

export function clockOffsetSeconds() {
    return offsetSeconds;
}
