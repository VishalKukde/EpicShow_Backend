import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    plan: {
      type: String,
      enum: ["free", "pro"],
      required: true,
      default: "pro",
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired", "past_due"],
      required: true,
      default: "active",
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    paymentProvider: {
      type: String,
      enum: ["razorpay"],
      required: true,
      default: "razorpay",
    },
    externalSubscriptionId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true }
);

// A user can only have one subscription in active payment state.
subscriptionSchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active" },
    name: "uniq_active_subscription_per_user",
  }
);

const Subscription =
  mongoose.models.Subscription ||
  mongoose.model("Subscription", subscriptionSchema);

export default Subscription;
