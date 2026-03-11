import mongoose from "mongoose";

const passwordChangeAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 15,
    },
  },
  { versionKey: false }
);

passwordChangeAttemptSchema.index({ user: 1, createdAt: -1 });

export default mongoose.models.PasswordChangeAttempt ||
  mongoose.model("PasswordChangeAttempt", passwordChangeAttemptSchema);
