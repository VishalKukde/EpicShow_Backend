import crypto from "crypto";
import QRCode from "qrcode";
import asyncHandler from "../../../utils/asyncHandler.js";
import { generateAccessToken, generateRefreshToken } from "../../../utils/generateToken.js";
import { parseUserAgent, getClientIp } from "../../../utils/parseUserAgent.js";
import User from "../../user/model/User.js";
import UserSession from "../../user/model/UserSession.js";
import {
    TOTP_LIMITS,
    canDecryptSecret,
    createEnrollment,
    decryptSecret,
    enrollmentUri,
    encryptSecret,
    isLocked,
    isWellFormedToken,
    lockoutMinutesRemaining,
    registerFailure,
    verifyToken,
} from "../service/admin-totp.service.js";
import { clearAdminThrottle } from "../middleware/adminThrottle.middleware.js";

/**
 * Admin sign-in with a mandatory second factor.
 *
 * Every response on the failure path is deliberately identical: a caller must
 * not be able to tell a wrong email from a wrong password from a wrong code,
 * or they can enumerate admins and confirm passwords without the authenticator.
 */

const GENERIC_FAILURE = "Invalid admin credentials or authentication code.";

const ACCESS_MAX_AGE = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 12 * 60 * 60 * 1000; // admin sessions stay short

function cookieOptions(req, maxAge) {
    const isProd = process.env.NODE_ENV === "production";
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";

    return {
        httpOnly: true,
        secure: isProd && isHttps,
        sameSite: isProd && isHttps ? "none" : "lax",
        path: "/",
        ...(maxAge ? { maxAge } : {}),
    };
}

/**
 * Loads an admin and checks the password.
 *
 * Returns null for every failure — the caller cannot distinguish the reasons,
 * and neither can the client.
 */
async function loadVerifiedAdmin(email, password) {
    if (!email || !password) return null;

    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select(
        "+password +adminTotp.secret +adminTotp.lastTimeStep +adminTotp.failedAttempts +adminTotp.lockedUntil"
    );

    if (!user) return null;
    if (user.role !== "admin") return null;
    if (!(await user.comparePassword(password))) return null;

    return user;
}

/**
 * Step 1 of enrolment: issue a secret and a QR code.
 *
 * Requires the admin's password, so possession of an unlocked browser is not
 * enough to re-enrol a new authenticator.
 */
export const startAdminTotpSetup = asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await loadVerifiedAdmin(email, password);

    if (!user) {
        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    if (user.status === "Suspended" || user.status === "Deactivated") {
        return res.status(403).json({ message: "Your account is suspended." });
    }

    // An enrolment that was started but never confirmed is resumed rather than
    // replaced. Rotating the secret on every call would silently invalidate a
    // QR code the admin had already scanned — and this endpoint is reached both
    // from the setup button and automatically after a "not set up" sign-in.
    const pending =
        user.adminTotp?.secret &&
        !user.adminTotp.enabled &&
        canDecryptSecret(user.adminTotp.secret);

    // `restart` is the explicit "my authenticator is gone, give me a new one"
    // escape hatch; it is the only way to discard a working enrolment.
    const restart = Boolean(req.body?.restart);

    let secret;
    let uri;

    if (pending && !restart) {
        secret = decryptSecret(user.adminTotp.secret);
        uri = enrollmentUri(user.email, secret);
    } else {
        // Re-enrolling replaces any previous authenticator and disables sign-in
        // until the new one is confirmed, so a half-finished setup cannot lock
        // the account into an unusable state.
        ({ secret, uri } = createEnrollment(user.email));

        user.adminTotp.secret = encryptSecret(secret);
        user.adminTotp.enabled = false;
        user.adminTotp.lastTimeStep = 0;
        user.adminTotp.failedAttempts = 0;
        user.adminTotp.lockedUntil = null;
        await user.save({ validateBeforeSave: false });
    }

    const qrDataUrl = await QRCode.toDataURL(uri, { width: 260, margin: 1 });

    return res.json({
        success: true,
        qrDataUrl,
        otpauthUri: uri,
        /** Shown so an admin can type it in if the camera will not scan. */
        manualKey: secret,
        issuer: "EpicShow Admin",
        account: user.email,
    });
});

/** Step 2 of enrolment: confirm the admin can produce a valid code. */
export const activateAdminTotp = asyncHandler(async (req, res) => {
    const { email, password, token } = req.body || {};
    const user = await loadVerifiedAdmin(email, password);

    if (!user || !user.adminTotp?.secret) {
        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    if (!canDecryptSecret(user.adminTotp.secret)) {
        return res.status(409).json({
            message: "This enrolment is no longer readable. Start the setup again to get a fresh QR code.",
            code: "TOTP_SETUP_REQUIRED",
        });
    }

    const secret = decryptSecret(user.adminTotp.secret);
    const result = verifyToken({ token, secret, lastTimeStep: 0 });

    if (!result.valid) {
        return res.status(401).json({ message: "That code is not valid. Try the current one." });
    }

    // Re-encrypt under whichever key is current, so a secret written under an
    // older key stops depending on that key still being configured.
    user.adminTotp.secret = encryptSecret(secret);
    user.adminTotp.enabled = true;
    user.adminTotp.activatedAt = new Date();
    user.adminTotp.lastTimeStep = result.timeStep;
    user.adminTotp.failedAttempts = 0;
    user.adminTotp.lockedUntil = null;
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, message: "Authenticator enabled for this admin account." });
});

/** Admin sign-in. Email, password and code must all pass. */
export const adminLogin = asyncHandler(async (req, res) => {
    const { email, password, token } = req.body || {};

    // Reject an obviously malformed code before touching the database.
    if (!isWellFormedToken(token)) {
        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    const user = await loadVerifiedAdmin(email, password);

    if (!user) {
        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    if (user.status === "Suspended" || user.status === "Deactivated") {
        return res.status(403).json({ message: "Your account is suspended" });
    }

    if (
        !user.adminTotp?.enabled ||
        !user.adminTotp?.secret ||
        !canDecryptSecret(user.adminTotp.secret)
    ) {
        return res.status(403).json({
            message: "Two-factor authentication is not set up for this account.",
            code: "TOTP_SETUP_REQUIRED",
        });
    }

    if (isLocked(user.adminTotp)) {
        return res.status(429).json({
            message: `Too many failed attempts. Try again in ${lockoutMinutesRemaining(user.adminTotp)} minute(s).`,
        });
    }

    const result = verifyToken({
        token,
        secret: decryptSecret(user.adminTotp.secret),
        lastTimeStep: user.adminTotp.lastTimeStep || 0,
    });

    if (!result.valid) {
        const failure = registerFailure(user.adminTotp);
        user.adminTotp.failedAttempts = failure.failedAttempts;
        user.adminTotp.lockedUntil = failure.lockedUntil;
        await user.save({ validateBeforeSave: false });

        if (failure.lockedUntil) {
            return res.status(429).json({
                message: `Too many failed attempts. Try again in ${TOTP_LIMITS.LOCK_MINUTES} minutes.`,
            });
        }

        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    // All three factors are good — record the step so this code cannot be reused.
    clearAdminThrottle(req);
    user.adminTotp.lastTimeStep = result.timeStep;
    user.adminTotp.failedAttempts = 0;
    user.adminTotp.lockedUntil = null;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const sessionId = crypto.randomUUID();
    const accessToken = generateAccessToken(user, "15m", sessionId);
    const refreshToken = generateRefreshToken(user, "12h", sessionId);

    const { device, browser, os, deviceType } = parseUserAgent(req.headers["user-agent"]);

    await UserSession.create({
        userId: user._id,
        sessionId,
        refreshToken,
        device,
        browser,
        os,
        deviceType,
        ipAddress: getClientIp(req),
        location: "Admin Console",
        userAgent: req.headers["user-agent"] || "",
        status: "active",
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_MAX_AGE),
    });

    res.cookie("accessToken", accessToken, cookieOptions(req, ACCESS_MAX_AGE));
    res.cookie("refreshToken", refreshToken, cookieOptions(req, REFRESH_MAX_AGE));

    return res.json({
        success: true,
        accessToken,
        sessionId,
        redirectTo: "/admin",
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            phone: user.phone,
            status: user.status || "Active",
            lastLogin: user.lastLogin,
            role: user.role,
            membership: user.membership,
            walletBalance: user.walletBalance,
            preferences: user.preferences,
            rewardPoints: user.rewardPoints,
        },
    });
});

/**
 * Whether the signed-in admin has an authenticator enrolled.
 *
 * Authenticated, and scoped to the caller: an admin can only ever read their
 * own state, never another account's.
 */
export const getAdminTotpStatus = asyncHandler(async (req, res) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const user = await User.findById(req.user.id).select("+adminTotp.secret");

    if (!user) {
        return res.status(404).json({ message: "Account not found" });
    }

    const enrolled =
        Boolean(user.adminTotp?.enabled) &&
        Boolean(user.adminTotp?.secret) &&
        canDecryptSecret(user.adminTotp.secret);

    return res.json({
        success: true,
        enabled: enrolled,
        activatedAt: enrolled ? user.adminTotp?.activatedAt || null : null,
    });
});

/**
 * Turns the second factor off.
 *
 * Deliberately requires BOTH the password and a current code: anyone who can
 * disable 2FA can bypass it, so removing it must be at least as hard as using
 * it. An unlocked browser alone is not enough.
 */
export const disableAdminTotp = asyncHandler(async (req, res) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    const { password, token } = req.body || {};

    const user = await User.findById(req.user.id).select(
        "+password +adminTotp.secret +adminTotp.lastTimeStep +adminTotp.failedAttempts +adminTotp.lockedUntil"
    );

    if (!user) {
        return res.status(404).json({ message: "Account not found" });
    }

    if (!password || !(await user.comparePassword(password))) {
        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    if (!user.adminTotp?.enabled || !user.adminTotp?.secret) {
        return res.status(409).json({ message: "Two-factor authentication is not enabled." });
    }

    if (isLocked(user.adminTotp)) {
        return res.status(429).json({
            message: `Too many failed attempts. Try again in ${lockoutMinutesRemaining(user.adminTotp)} minute(s).`,
        });
    }

    const result = verifyToken({
        token,
        secret: decryptSecret(user.adminTotp.secret),
        lastTimeStep: user.adminTotp.lastTimeStep || 0,
    });

    if (!result.valid) {
        const failure = registerFailure(user.adminTotp);
        user.adminTotp.failedAttempts = failure.failedAttempts;
        user.adminTotp.lockedUntil = failure.lockedUntil;
        await user.save({ validateBeforeSave: false });

        return res.status(401).json({ message: GENERIC_FAILURE });
    }

    // Clear the secret outright rather than just flipping the flag, so a
    // disabled account never leaves a usable credential behind.
    user.adminTotp.secret = null;
    user.adminTotp.enabled = false;
    user.adminTotp.lastTimeStep = 0;
    user.adminTotp.failedAttempts = 0;
    user.adminTotp.lockedUntil = null;
    user.adminTotp.activatedAt = null;
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, message: "Two-factor authentication disabled." });
});
