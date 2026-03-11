import mongoose from "mongoose";

const rewardTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["redeem", "earn"],
      required: true,
    },
    points: {
      type: Number,
      required: true,
      min: 1,
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
  },
  { timestamps: true }
);

rewardTransactionSchema.index({ user: 1, createdAt: -1 });

const RewardTransaction =
  mongoose.models.RewardTransaction ||
  mongoose.model("RewardTransaction", rewardTransactionSchema);

export default RewardTransaction;
