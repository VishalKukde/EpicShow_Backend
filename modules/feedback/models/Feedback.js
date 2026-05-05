import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    userName: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "Booking Experience",
        "Payments",
        "App Performance",
        "UI and Design",
        "Feature Request",
        "Support",
        "Other",
      ],
    },

    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    // whether user allows showing publicly
    isPublic: {
      type: Boolean,
      default: false,
    },

    // mark as testimonial
    isFeatured: {
      type: Boolean,
      default: false,
    },
    displayMessage: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

feedbackSchema.index({ isPublic: 1, isFeatured: 1, createdAt: -1 });

export default mongoose.model("Feedback", feedbackSchema);
