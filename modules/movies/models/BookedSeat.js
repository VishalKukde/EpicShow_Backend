import mongoose from "mongoose";

const BookedSeatSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    showType: {
      type: String,
      trim: true,
      default: "movie",
    },
    showId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
    },
    cinemaId: {
      type: String,
      required: true,
      trim: true,
    },
    showDate: {
      type: String,
      required: true,
      trim: true,
    },
    showSlot: {
      type: String,
      required: true,
      trim: true,
    },
    seatId: {
      type: String,
      required: true,
      trim: true,
    },
    paymentId: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

BookedSeatSchema.index({ showId: 1, seatId: 1 }, { unique: true });
BookedSeatSchema.index({ bookingId: 1, seatId: 1 }, { unique: true });

export default mongoose.model("BookedSeat", BookedSeatSchema);
