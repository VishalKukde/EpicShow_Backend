import mongoose, { Schema } from "mongoose";

const savedTrainPassengerSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
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
  },
  { timestamps: true }
);

savedTrainPassengerSchema.index(
  { userId: 1, normalizedName: 1, age: 1, gender: 1 },
  { unique: true }
);

export default mongoose.model("SavedTrainPassenger", savedTrainPassengerSchema);
