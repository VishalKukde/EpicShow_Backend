import mongoose, { Schema } from "mongoose";

const movieSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      required: true
    },

    genre: {
      type: [String],
      required: true
    },

    imageUrl: {
      type: String,
      required: true
    },

    language: {
      type: String,
      required: true,
      uppercase: true
    },

    runtimeMinutes: {
      type: Number,
      required: true
    },

    rating: {
      type: Number,
      required:true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Movies", movieSchema);
