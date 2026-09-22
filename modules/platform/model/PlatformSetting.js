import mongoose from "mongoose";

/**
 * Platform-wide controls an admin applies to end users.
 * A single document, addressed by a fixed key.
 */
const platformSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: "platform",
    },

    /** How many seats a member of each tier may hold in one booking. */
    ticketLimits: {
      free: { type: Number, default: 2, min: 1, max: 20 },
      pro: { type: Number, default: 5, min: 1, max: 20 },
    },

    /** Banner shown across the storefront. */
    announcement: {
      enabled: { type: Boolean, default: false },
      message: { type: String, default: "", trim: true },
      tone: { type: String, enum: ["info", "warning", "success"], default: "info" },
    },

    /** How long a cart holds its seats, per tier, in seconds. */
    seatHoldSeconds: {
      free: { type: Number, default: 300, min: 60, max: 3600 },
      pro: { type: Number, default: 600, min: 60, max: 3600 },
    },

    /** Loyalty points earned per rupee, and the Pro multiplier on top. */
    rewards: {
      earnRate: { type: Number, default: 0.1, min: 0, max: 1 },
      proMultiplier: { type: Number, default: 2, min: 1, max: 10 },
    },

    /** Turn new sign-ups on or off without a deploy. */
    registrationEnabled: { type: Boolean, default: true },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.PlatformSetting ||
  mongoose.model("PlatformSetting", platformSettingSchema);
