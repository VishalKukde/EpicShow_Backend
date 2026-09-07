import mongoose from "mongoose";

const userSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        refreshToken: {
            type: String,
            required: true,
            index: true,
        },
        device: {
            type: String,
            default: "Unknown Device",
        },
        browser: {
            type: String,
            default: "Unknown Browser",
        },
        os: {
            type: String,
            default: "Unknown OS",
        },
        deviceType: {
            type: String,
            enum: ["desktop", "mobile", "tablet"],
            default: "desktop",
        },
        ipAddress: {
            type: String,
            default: "127.0.0.1",
        },
        location: {
            type: String,
            default: "Active Session",
        },
        userAgent: {
            type: String,
            default: "",
        },
        status: {
            type: String,
            enum: ["active", "revoked"],
            default: "active",
            index: true,
        },
        lastActiveAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    { timestamps: true }
);

userSessionSchema.index({ userId: 1, status: 1 });

export default mongoose.model("UserSession", userSessionSchema);
