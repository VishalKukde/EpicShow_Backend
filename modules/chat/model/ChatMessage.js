import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    conversationUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "admin"],
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recipientRole: {
      type: String,
      enum: ["user", "admin"],
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    isReadByAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
    isReadByUser: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationUserId: 1, createdAt: 1 });
chatMessageSchema.index({ conversationUserId: 1, senderRole: 1, isReadByAdmin: 1 });
chatMessageSchema.index({ conversationUserId: 1, senderRole: 1, isReadByUser: 1 });

export default mongoose.model("ChatMessage", chatMessageSchema);
