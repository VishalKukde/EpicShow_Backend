import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["PERCENT", "FLAT"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      default: null,
    },
    minAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    validTill: {
      type: Date,
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    applicableBookingTypes: {
      type: [String],
      enum: ["movie", "event", "sport", "gaming", "train"],
      default: ["movie", "event", "sport", "gaming"],
    },
    categoryId: {
      type: String,
      default: "general",
      trim: true,
    },
    categoryTitle: {
      type: String,
      default: "General Offers",
      trim: true,
    },
    conditions: {
      type: [String],
      default: [],
    },
    discountLabel: {
      type: String,
      default: "",
      trim: true,
    },
    usageLimit: {
      type: Number,
      default: 1000,
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "scheduled", "expired"],
      default: "active",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

couponSchema.pre("save", function () {
  if (this.code) {
    this.code = this.code.toUpperCase().trim();
  }

  if (!this.discountLabel) {
    if (this.discountType === "PERCENT") {
      const cap = this.maxDiscount ? ` up to ₹${this.maxDiscount}` : "";
      this.discountLabel = `${this.value}% OFF${cap}`;
    } else {
      this.discountLabel = `₹${this.value} OFF`;
    }
  }

  if (!this.conditions || this.conditions.length === 0) {
    const types = (this.applicableBookingTypes || [])
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .join(", ");
    const expiryStr = this.validTill
      ? new Date(this.validTill).toISOString().slice(0, 10)
      : "";

    this.conditions = [
      `Minimum booking ₹${this.minAmount || 0}`,
      types ? `Valid on ${types}` : "Valid on all bookings",
      expiryStr ? `Use before ${expiryStr}` : "Limited period offer",
    ];
  }

  const now = new Date();
  if (this.validTill && new Date(this.validTill) < now) {
    this.status = "expired";
  } else if (this.startDate && new Date(this.startDate) > now && this.status !== "expired") {
    this.status = "scheduled";
  }
});

export default mongoose.model("Coupon", couponSchema);
