import mongoose from "mongoose";

const userCouponSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    couponId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "USED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },
    allocatedAt: {
      type: Date,
      default: null,
    },
    collectedAt: {
      type: Date,
      default: Date.now,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    usedBookingId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

userCouponSchema.index({ userId: 1, couponId: 1 }, { unique: true });

export default mongoose.model("UserCoupon", userCouponSchema);
