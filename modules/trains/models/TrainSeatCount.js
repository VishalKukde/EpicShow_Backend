import mongoose, { Schema } from "mongoose";

const trainSeatCountSchema = new Schema(
  {
    trainId: {
      type: Schema.Types.ObjectId,
      ref: "Train",
      required: true,
    },
    journeyDate: {
      type: Date,
      required: true,
    },
    capacity: {
      type: Number,
      default: 10,
      min: 1,
    },
    confirmedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },
    waitlistCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

trainSeatCountSchema.index({ trainId: 1, journeyDate: 1 }, { unique: true });

export default mongoose.model("TrainSeatCount", trainSeatCountSchema);
