import mongoose from "mongoose";

const userCouponSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    _id: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "USED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
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

userCouponSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model("UserCoupon", userCouponSchema);
