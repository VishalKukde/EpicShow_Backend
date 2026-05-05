import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true
  },

  orderId: {
    type: String,
    required: true
  },

  paymentId: {
    type: String,
    required: true,
    unique: true // prevent duplicate payment insert
  },

  signature: {
    type: String,
    required: true
  },

  method: {
    type: String // upi, card, netbanking, wallet
  },

  amount: {
    type: Number,
    required: true
  },

  currency: {
    type: String,
    default: "INR"
  },

  status: {
    type: String,
    enum: ["success", "failed", "refunded","refund_initiated"],
    required: true
  },
    refundId: { type: String},

}, { timestamps: true });

export default mongoose.model("Payment", PaymentSchema);
