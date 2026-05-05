import crypto from "crypto";
import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => crypto.randomUUID(),
    },

    user_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    movie_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    booking_id: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    comment: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

reviewSchema.index({ movie_id: 1, created_at: -1 });

export default mongoose.model("Review", reviewSchema);
