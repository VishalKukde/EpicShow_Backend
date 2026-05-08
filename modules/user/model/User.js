import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    phone: {
      type: String,
      trim: true,
    },

    avatar: {
      type: String,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    membership: {
      type: String,
      enum: ["free", "pro"],
      default: "free",
    },

    walletBalance: {
      type: Number,
      default: 0,
    },

    preferences: {
      darkMode: { type: Boolean, default: false },
      notifications: { type: Boolean, default: false },
      seat: {
        movieSeat: {
          type: String,
          enum: ["front", "middle", "back"],
          default: "middle",
        },
        sportSeat: {
          type: String,
          enum: ["field_side", "center_view", "covered_upper"],
          default: "center_view",
        },
        trainSeat: {
          type: String,
          enum: ["window", "lower_berth", "aisle"],
          default: "window",
        },
        flightSeat: {
          type: String,
          enum: ["window", "aisle", "extra_legroom"],
          default: "window",
        },
      },
      payment: {
        preferredMethod: {
          type: String,
          enum: ["card", "upi", "wallet"],
          default: "card",
        },

        lastUsedMethod: {
          type: String,
          enum: ["card", "upi", "wallet"],
          default: "card",
        },

        disabledMethods: {
          card: { type: Boolean, default: false },
          upi: {type: Boolean, default: false},
          wallet: {type: Boolean, default: false},
        },
      }
    },

    rewardPoints: {
      type: Number,
      default: 0,
      min: 0
    },

    lastLogin: Date,

    refreshToken: String,

    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Index
userSchema.index({ email: 1 });

// Hash password
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Hide sensitive fields
userSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.refreshToken;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model("User", userSchema);
