import mongoose from "mongoose";

const broadcastCampaignSchema = new mongoose.Schema(
  {
    broadcastId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: ["Push Notification", "In-App Popup", "SMS Alert"],
      default: "Push Notification",
    },
    targetSegment: {
      type: String,
      default: "All Registered Users",
    },
    deepLink: {
      type: String,
      default: "/movies",
    },
    status: {
      type: String,
      enum: ["Delivered", "Processing", "Failed", "Scheduled"],
      default: "Delivered",
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    readCount: {
      type: Number,
      default: 0,
    },
    dispatchedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

broadcastCampaignSchema.index({ dispatchedAt: -1 });

export default mongoose.models.BroadcastCampaign ||
  mongoose.model("BroadcastCampaign", broadcastCampaignSchema);
