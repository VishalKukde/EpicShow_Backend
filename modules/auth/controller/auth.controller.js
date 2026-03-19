import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { generateAccessToken, generateRefreshToken } from "../../../utils/generateToken.js";
import asyncHandler from "../../../utils/asyncHandler.js";
import { sendPasswordChangedEmail } from "../../../utils/email.js";
import User from "../../user/model/User.js";

dotenv.config();
const isProd = process.env.NODE_ENV === "production";

export const register = asyncHandler(async (req, res) => {
    await User.create(req.body)
    res.status(201).json({
        message: "User registered successfully. Please login."
    })
})

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

    const accessToken = generateAccessToken(user)
    const remember = Boolean(rememberMe);
    const refreshToken = generateRefreshToken(user, remember ? "7d" : "1d")

    // save refresh token in DB
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();

    await user.save({ validateBeforeSave: false });

    res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
    });

    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        ...(remember ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
    });

    res.json({
        accessToken,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            phone: user.phone,
            lastLogin: user.lastLogin,
            role: user.role,
            membership: user.membership,
            walletBalance: user.walletBalance,
            preferences: user.preferences,
            rewardPoints: user.rewardPoints,
        }
    })
})

export const refresh = asyncHandler(async (req, res) => {

    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ message: "No refresh token" });
    }

    const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id);

    if (!user || refreshToken !== user.refreshToken) {
        return res.status(403).json({ message: "Invalid refresh token" });
    }

    const tokenVersion = Number(decoded?.tokenVersion ?? 0);
    if (tokenVersion !== Number(user.tokenVersion ?? 0)) {
        return res.status(403).json({ message: "Refresh token expired. Please login again." });
    }

    const newAccessToken = generateAccessToken(user);

    res.json({
        accessToken: newAccessToken,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            phone: user.phone,
            lastLogin: user.lastLogin,
            role: user.role,
            membership: user.membership,
            walletBalance: user.walletBalance,
            preferences: user.preferences,
            rewardPoints: user.rewardPoints,
        }
    });
});

export const logout = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
        const user = await User.findOne({ refreshToken });

        if (user) {
            user.refreshToken = null;
            await user.save();
        }
    }

    res.clearCookie("refreshToken");
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

    // enabled this in production
    // const strongPasswordPattern =
    //     /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

    // if (!strongPasswordPattern.test(newPassword)) {
    //     return res.status(400).json({
    //         message:
    //             "Password must be at least 8 characters and include uppercase, lowercase, number, and special character",
    //     });
    // }

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

    res.clearCookie("refreshToken");

    // Fire-and-forget notification; password change should not fail if mail provider is unavailable.
    sendPasswordChangedEmail({
        to: 'vishalkukde4432@gmail.com',
        name: user.name,
        changedAt: new Date(),
    }).catch((error) => {
        console.error("Password changed email failed:", error?.message || error);
    });

    return res.status(200).json({
        message: "Password changed successfully. Please login again.",
    });
});
