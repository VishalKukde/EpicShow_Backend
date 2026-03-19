import mongoose from "mongoose";

const exportLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["wallet", "reward", "booking"],
      required: true,
    },
    exportedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.ExportLog ||
  mongoose.model("ExportLog", exportLogSchema);
