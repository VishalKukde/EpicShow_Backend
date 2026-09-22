import crypto from "crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import { trustedEpochSeconds } from "./trusted-time.service.js";

/**
 * TOTP for admin sign-in (RFC 6238, SHA-1, 6 digits, 30s period) — the profile
 * Microsoft Authenticator and Google Authenticator both implement.
 *
 * The shared secret is the whole security of the second factor, so it is
 * encrypted at rest with AES-256-GCM rather than stored as plain base32.
 */

const ISSUER = "EpicShow Admin";

/**
 * No drift allowance: only the code for the current 30s window is accepted.
 *
 * A phone whose clock is off by even one step is rejected, as is a code typed
 * just after its window rolled over.
 */
const EPOCH_TOLERANCE_SECONDS = 0;

const FAILED_ATTEMPT_LIMIT = 5;
const LOCK_MINUTES = 15;

/**
 * A dedicated key is strongly preferred. Without one the key is derived from
 * JWT_SECRET so development still works — but rotating JWT_SECRET would then
 * make every enrolled secret undecryptable, hence the warning.
 */
function dedicatedKey() {
  const configured = process.env.TOTP_ENCRYPTION_KEY;
  if (!configured) return null;

  const key = Buffer.from(configured, "hex");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }

  return key;
}

/** The pre-dedicated-key derivation, kept so older secrets still decrypt. */
function legacyKey() {
  if (!process.env.JWT_SECRET) return null;
  return crypto.scryptSync(process.env.JWT_SECRET, "epicshow-admin-totp", 32);
}

/** The key new secrets are encrypted with. */
function encryptionKey() {
  const dedicated = dedicatedKey();
  if (dedicated) return dedicated;

  const legacy = legacyKey();
  if (!legacy) {
    throw new Error("Set TOTP_ENCRYPTION_KEY (or at least JWT_SECRET) before using admin TOTP");
  }

  if (!encryptionKey.warned) {
    console.warn(
      "[admin-totp] TOTP_ENCRYPTION_KEY is not set; deriving from JWT_SECRET. " +
      "Set a dedicated key — rotating JWT_SECRET would otherwise invalidate every enrolled authenticator."
    );
    encryptionKey.warned = true;
  }

  return legacy;
}

/**
 * Every key a stored secret might have been encrypted under, newest first.
 *
 * Introducing TOTP_ENCRYPTION_KEY on a server that had been falling back to the
 * JWT-derived key would otherwise strand every existing enrolment, since GCM
 * simply fails to authenticate under the new key.
 */
function decryptionKeys() {
  return [dedicatedKey(), legacyKey()].filter(Boolean);
}

/** iv:authTag:ciphertext, all hex. */
export function encryptSecret(plainSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload) {
  const [ivHex, tagHex, dataHex] = String(payload || "").split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed TOTP secret");

  for (const key of decryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Wrong key for this secret — try the next one.
    }
  }

  throw new Error("Could not decrypt TOTP secret with any configured key");
}

/** True when the stored secret can still be read back. */
export function canDecryptSecret(payload) {
  try {
    decryptSecret(payload);
    return true;
  } catch {
    return false;
  }
}

/** The otpauth:// URI an authenticator scans for a given secret. */
export function enrollmentUri(email, secret) {
  return generateURI({ secret, label: email, issuer: ISSUER });
}

/** A fresh base32 secret plus its otpauth:// URI. */
export function createEnrollment(email) {
  const secret = generateSecret();
  return { secret, uri: enrollmentUri(email, secret) };
}

/** Six digits, nothing else — otplib throws on a malformed token. */
export const isWellFormedToken = (token) => /^\d{6}$/.test(String(token ?? "").trim());

/**
 * Verifies a code against a secret.
 *
 * `afterTimeStep` is what stops a code being replayed: each accepted code
 * records its time step, and anything at or before it is refused.
 */
export function verifyToken({ token, secret, lastTimeStep = 0 }) {
  if (!isWellFormedToken(token)) {
    return { valid: false, reason: "malformed" };
  }

  try {
    const result = verifySync({
      token: String(token).trim(),
      secret,
      // This host's clock is not reliable, so TOTP is evaluated against
      // corrected time — otherwise no authenticator could ever agree with it.
      epoch: trustedEpochSeconds(),
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
      ...(lastTimeStep > 0 ? { afterTimeStep: lastTimeStep } : {}),
    });

    return result?.valid
      ? { valid: true, timeStep: result.timeStep }
      : { valid: false, reason: lastTimeStep > 0 ? "invalid-or-replayed" : "invalid" };
  } catch {
    // otplib throws on malformed input rather than returning a result.
    return { valid: false, reason: "malformed" };
  }
}

/** True while the account is inside its lockout window. */
export function isLocked(totp) {
  return Boolean(totp?.lockedUntil && new Date(totp.lockedUntil).getTime() > Date.now());
}

export function lockoutMinutesRemaining(totp) {
  if (!isLocked(totp)) return 0;
  return Math.max(1, Math.ceil((new Date(totp.lockedUntil).getTime() - Date.now()) / 60000));
}

/** Applies a failed attempt, locking the account once the limit is reached. */
export function registerFailure(totp) {
  const failedAttempts = (totp?.failedAttempts || 0) + 1;

  if (failedAttempts >= FAILED_ATTEMPT_LIMIT) {
    return {
      failedAttempts: 0,
      lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000),
    };
  }

  return { failedAttempts, lockedUntil: null };
}

export const TOTP_LIMITS = { FAILED_ATTEMPT_LIMIT, LOCK_MINUTES };
