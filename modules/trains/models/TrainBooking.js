import mongoose, { Schema } from "mongoose";

const passengerDetailSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  age: {
    type: Number,
    required: true,
    min: 1,
    max: 120,
  },
  gender: {
    type: String,
    enum: ["M", "F", "Other"],
    required: true,
  },
  seatNumber: {
    type: String,
    required: true,
  },
});

const trainBookingSchema = new Schema(
  {
    trainId: {
      type: Schema.Types.ObjectId,
      ref: "Train",
      required: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    pnr: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    seats: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return v && v.length > 0;
        },
        message: "At least one seat must be selected",
      },
    },

    passengerDetails: {
      type: [passengerDetailSchema],
      required: true,
      validate: {
        validator: function (v) {
          return v && v.length === this.seats.length;
        },
        message: "Number of passengers must match number of seats",
      },
    },

    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    baseAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    bookingDate: {
      type: Date,
      default: Date.now,
    },

    journeyDate: {
      type: Date,
      default: Date.now,
    },

    status: {
      type: String,
      enum: ["confirmed", "cancelled", "pending", "failed"],
      default: "pending",
    },

    seatStatus: {
      type: String,
      enum: ["pending", "confirmed", "waitlisted", "partial_waitlisted"],
      default: "pending",
    },

    confirmedSeatCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    waitlistNumbers: {
      type: [Number],
      default: [],
    },

    razorpayOrderId: {
      type: String,
      trim: true,
      default: null,
    },

    payment: {
      transactionId: {
        type: String,
        default: null,
      },
      amount: {
        type: Number,
        required: true,
      },
      method: {
        type: String,
        enum: ["card", "upi", "wallet", "netbanking"],
        required: true,
      },
      status: {
        type: String,
        enum: ["success", "failed", "pending"],
        default: "pending",
      },
      orderId: String,
      signature: String,
      currency: {
        type: String,
        default: "INR",
      },
    },

    cancellationDetails: {
      cancelledAt: Date,
      refundAmount: Number,
      refundStatus: {
        type: String,
        enum: ["pending", "processed", "failed"],
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
trainBookingSchema.index({ userId: 1 });
trainBookingSchema.index({ trainId: 1 });
trainBookingSchema.index({ pnr: 1 });
trainBookingSchema.index({ bookingDate: -1 });
trainBookingSchema.index({ journeyDate: 1 });

export default mongoose.model("TrainBooking", trainBookingSchema);
