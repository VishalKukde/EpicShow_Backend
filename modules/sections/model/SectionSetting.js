import mongoose from "mongoose";

/** One document per bookable section (movies, sports, trains, gaming). */
const sectionSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    bookingEnabled: {
      type: Boolean,
      default: true,
    },
    message: {
      type: String,
      default: "",
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.SectionSetting ||
  mongoose.model("SectionSetting", sectionSettingSchema);
