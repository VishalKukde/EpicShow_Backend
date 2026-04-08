import mongoose, { Schema } from "mongoose";

const eventSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    showType: {
      type: String,
      enum: ["gaming"],
      default: "gaming",
      immutable: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    venue: {
      type: String,
      required: true,
      trim: true,
    },
    venueId: {
      type: String,
      default: null,
    },
    startDateTime: {
      type: Date,
      required: true,
    },
    endDateTime: {
      type: Date,
    },
    price: {
      type: Number,
      required: true,
    },
    totalSeats: {
      type: Number,
      required: true,
    },
    availableSeats: {
      type: Number,
      required: true,
    },
    organizer: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: "/assets/category/Gaming.png",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Gaming", eventSchema);
