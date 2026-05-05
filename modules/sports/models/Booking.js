import mongoose from "mongoose";

const sportBookingSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    matchId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    sportType: {
      type: String,
      required: true,
      default: "Sport",
      trim: true,
    },
    league: {
      type: String,
      required: true,
      trim: true,
    },
    matchNo: {
      type: String,
      trim: true,
    },
    teams: {
      teamA: { type: String, required: true, trim: true },
      teamB: { type: String, required: true, trim: true },
      label: { type: String, trim: true },
    },
    schedule: {
      date: { type: String, required: true, trim: true },
      time: { type: String, required: true, trim: true },
    },
    venue: {
      id: { type: String, required: true, trim: true },
      name: { type: String, trim: true },
      city: { type: String, trim: true },
    },
    seatIds: {
      type: [String],
      default: [],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    coupon: {
      type: String,
      default: null,
      trim: true,
    },
    couponId: {
      type: String,
      default: null,
      trim: true,
    },
    userCouponId: {
      type: String,
      default: null,
      trim: true,
    },
    couponDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    rewardPointsRedeemed: {
      type: Number,
      default: 0,
      min: 0,
    },
    rewardDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled", "refunded", "expired"],
      default: "pending",
    },
    paymentId: {
      type: String,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
);

export default mongoose.model("SportBooking", sportBookingSchema);
