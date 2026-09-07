import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import dotenv from "dotenv";
import { generateAccessToken, generateRefreshToken } from "../../../utils/generateToken.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import { sendPasswordChangedEmail } from "../../../utils/email.js";
import { parseUserAgent, getClientIp } from "../../../utils/parseUserAgent.js";
import User from "../../user/model/User.js";
import UserSession from "../../user/model/UserSession.js";

dotenv.config();
const isProd = process.env.NODE_ENV === "production";
const accessMaxAge = 15 * 60 * 1000; // 15 minutes

const isHttpsRequest = (req) =>
    req.secure || req.headers["x-forwarded-proto"] === "https";

const cookieOptions = (req, maxAge) => {
    const isHttps = isHttpsRequest(req);

    return {
        httpOnly: true,
        secure: isHttps,
        sameSite: isProd && isHttps ? "none" : "lax",
        path: "/",
        ...(maxAge ? { maxAge } : {}),
    };
};

export const register = asyncHandler(async (req, res) => {
    await User.create(req.body);
    res.status(201).json({
        message: "User registered successfully. Please login.",
    });
});

export const login = asyncHandler(async (req, res) => {
    const { email, password, rememberMe } = req.body;
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status === "Suspended" || user.status === "Deactivated") {
        return res.status(403).json({ message: "Your account is suspended" });
    }

    const sessionId = crypto.randomUUID();
    const remember = Boolean(rememberMe);
    const refreshExpiresIn = remember ? "7d" : "1d";
    const refreshMaxAge = remember ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    const accessToken = generateAccessToken(user, "15m", sessionId);
    const refreshToken = generateRefreshToken(user, refreshExpiresIn, sessionId);

    const { device, browser, os, deviceType } = parseUserAgent(req.headers["user-agent"]);
    const ipAddress = getClientIp(req);

    // Store multi-device active session without invalidating existing sessions
    await UserSession.create({
        userId: user._id,
        sessionId,
        refreshToken,
        device,
        browser,
        os,
        deviceType,
        ipAddress,
        location: "Active Location",
        userAgent: req.headers["user-agent"] || "",
        status: "active",
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + refreshMaxAge),
    });

    // Keep user.lastLogin updated for backward compatibility
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    res.cookie("accessToken", accessToken, cookieOptions(req, accessMaxAge));
    res.cookie("refreshToken", refreshToken, cookieOptions(req, refreshMaxAge));

    res.json({
        accessToken,
        sessionId,
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

export const refresh = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ message: "No refresh token" });
    }

    try {
        const decoded = jwt.verify(
            refreshToken,
            process.env.JWT_REFRESH_SECRET
        );

        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(403).json({ message: "Invalid refresh token" });
        }

        if (user.status === "Suspended" || user.status === "Deactivated") {
            return res.status(403).json({ message: "Your account is suspended" });
        }

        const tokenVersion = Number(decoded?.tokenVersion ?? 0);
        if (tokenVersion !== Number(user.tokenVersion ?? 0)) {
            return res.status(403).json({ message: "Refresh token expired. Please login again." });
        }

        // Verify session is active
        const session = await UserSession.findOne({
            $or: [
                { refreshToken },
                ...(decoded.sessionId ? [{ sessionId: decoded.sessionId }] : []),
            ],
            userId: user._id,
            status: "active",
        });

        if (!session) {
            res.clearCookie("accessToken", cookieOptions(req));
            res.clearCookie("refreshToken", cookieOptions(req));
            return res.status(401).json({ message: "Session revoked or expired" });
        }

        session.lastActiveAt = new Date();
        await session.save();

        const newAccessToken = generateAccessToken(user, "15m", session.sessionId);

        res.cookie("accessToken", newAccessToken, cookieOptions(req, accessMaxAge));

        res.json({
            accessToken: newAccessToken,
            sessionId: session.sessionId,
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
    } catch {
        return res.status(403).json({ message: "Invalid refresh token" });
    }
});

export const logout = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    const sessionId = req.sessionId;

    if (refreshToken || sessionId) {
        const query = [];
        if (refreshToken) query.push({ refreshToken });
        if (sessionId) query.push({ sessionId });

        await UserSession.updateOne(
            { $or: query },
            { status: "revoked" }
        );
    }

    res.clearCookie("accessToken", cookieOptions(req));
    res.clearCookie("refreshToken", cookieOptions(req));
    res.json({ message: "Logged out" });
});

export const changePassword = asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: "New password and confirm password must match" });
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
        return res.status(400).json({ message: "New password must be different from current password" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                password: hashedPassword,
                refreshToken: null,
            },
            $inc: { tokenVersion: 1 },
        }
    );

    // Revoke all active sessions on password change
    await UserSession.updateMany(
        { userId: user._id, status: "active" },
        { status: "revoked" }
    );

    res.clearCookie("accessToken", cookieOptions(req));
    res.clearCookie("refreshToken", cookieOptions(req));

    sendPasswordChangedEmail({
        to: "vishalkukde4432@gmail.com",
        name: user.name,
        changedAt: new Date(),
    }).catch((error) => {
        console.error("Password changed email failed:", error?.message || error);
    });

    return res.status(200).json({
        message: "Password changed successfully. Please login again.",
    });
});

// GET /auth/sessions - Get all active sessions for current user
export const getSessions = asyncHandler(async (req, res) => {
    const userId = req.user?._id || req.user?.id;
    const currentRefreshToken = req.cookies.refreshToken;
    const currentSessionId = req.sessionId;

    const sessions = await UserSession.find({
        userId,
        status: "active",
    }).sort({ lastActiveAt: -1 });

    const formatted = sessions.map((s) => {
        const isCurrent = Boolean(
            (currentSessionId && s.sessionId === currentSessionId) ||
            (currentRefreshToken && s.refreshToken === currentRefreshToken)
        );

        return {
            id: s._id,
            sessionId: s.sessionId,
            device: s.device,
            browser: s.browser,
            os: s.os,
            deviceType: s.deviceType,
            ipAddress: s.ipAddress,
            location: s.location || "Active Location",
            lastActiveAt: s.lastActiveAt,
            createdAt: s.createdAt,
            isCurrent,
        };
    });

    res.json({ sessions: formatted });
});

// DELETE /auth/sessions/:sessionId - Revoke a specific session
export const revokeSession = asyncHandler(async (req, res) => {
    const userId = req.user?._id || req.user?.id;
    const { sessionId } = req.params;
    const currentRefreshToken = req.cookies.refreshToken;
    const currentSessionId = req.sessionId;

    const session = await UserSession.findOne({
        $or: [{ sessionId }, { _id: sessionId.match(/^[0-9a-fA-F]{24}$/) ? sessionId : null }].filter(Boolean),
        userId,
    });

    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }

    session.status = "revoked";
    await session.save();

    const isCurrent = Boolean(
        (currentSessionId && session.sessionId === currentSessionId) ||
        (currentRefreshToken && session.refreshToken === currentRefreshToken)
    );

    if (isCurrent) {
        res.clearCookie("accessToken", cookieOptions(req));
        res.clearCookie("refreshToken", cookieOptions(req));
    }

    res.json({ message: "Session revoked successfully", isCurrent });
});

// DELETE /auth/sessions/other - Logout/Revoke all other devices
export const revokeOtherSessions = asyncHandler(async (req, res) => {
    const userId = req.user?._id || req.user?.id;
    const currentRefreshToken = req.cookies.refreshToken;
    const currentSessionId = req.sessionId;

    const currentSession = await UserSession.findOne({
        $or: [
            ...(currentSessionId ? [{ sessionId: currentSessionId }] : []),
            ...(currentRefreshToken ? [{ refreshToken: currentRefreshToken }] : []),
        ],
        userId,
        status: "active",
    });

    const excludeQuery = currentSession
        ? { _id: { $ne: currentSession._id } }
        : {};

    await UserSession.updateMany(
        { userId, status: "active", ...excludeQuery },
        { status: "revoked" }
    );

    res.json({ message: "All other sessions logged out successfully" });
});
