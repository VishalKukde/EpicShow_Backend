import mongoose, { Schema } from "mongoose";

const trainSchema = new Schema(
  {
    trainNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    trainName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    fromStation: {
      type: String,
      required: true,
      trim: true,
    },

    toStation: {
      type: String,
      required: true,
      trim: true,
    },

    imageUrl: {
      type: String,
      required: true,
    },

    trainType: {
      type: String,
      enum: ["Express", "Superfast", "Local", "AC", "Sleeper"],
      required: true,
    },

    totalSeats: {
      type: Number,
      required: true,
      min: 1,
    },

    availableSeats: {
      type: Number,
      required: true,
      min: 0,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    duration: {
      type: String,
      required: true, // e.g., "15h 30m"
    },

    departureTime: {
      type: String,
      required: true, // e.g., "22:00"
    },

    arrivalTime: {
      type: String,
      required: true, // e.g., "13:30"
    },

    rating: {
      type: Number,
      default: 4.0,
      min: 0,
      max: 5,
    },

    avg_rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    total_reviews: {
      type: Number,
      default: 0,
      min: 0,
    },

    amenities: {
      type: [String],
      default: [],
    },

    operatingDays: {
      type: [String],
      default: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
trainSchema.index({ fromStation: 1, toStation: 1 });
trainSchema.index({ trainType: 1 });
trainSchema.index({ departureTime: 1 });

export default mongoose.model("Train", trainSchema);
