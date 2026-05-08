import mongoose from "mongoose";

const subscriptionCheckoutSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    plan: {
      type: String,
      enum: ["pro"],
      required: true,
      default: "pro",
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      required: true,
      default: "monthly",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
      index: true,
    },
    razorpayOrderId: String,
    paymentId: String,
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true }
);

subscriptionCheckoutSchema.index({ userId: 1, status: 1, createdAt: -1 });

const SubscriptionCheckout =
  mongoose.models.SubscriptionCheckout ||
  mongoose.model("SubscriptionCheckout", subscriptionCheckoutSchema);

export default SubscriptionCheckout;
