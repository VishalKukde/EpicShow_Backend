import mongoose from "mongoose";

const BookingSchema = new mongoose.Schema({
  userId:String,
  cinemaId: String,
  itemId: String,
  showId: {
    type: String,
    trim: true,
    index: true,
  },
  date: String,
  slot: String,
  seatIds: [String],
  amount: Number,
  coupon: String,
  paymentId: {
    type: String,
    trim: true,
    default: null,
  },
  razorpayOrderId: {
    type: String,
    trim: true,
    default: null,
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
    default: "pending"
  },

  showType: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Booking", BookingSchema);
