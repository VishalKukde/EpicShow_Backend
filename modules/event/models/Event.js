import mongoose, { Schema } from "mongoose";

export const EVENT_CATEGORIES = [
  "gaming",
  "concert",
  "workshop",
  "conference",
  "festival",
  "comedy",
  "other",
]

export const EVENT_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
]
const ticketTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    totalSeats: {
      type: Number,
      required: true,
      min: 0,
    },
    availableSeats: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const eventSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      enum: EVENT_CATEGORIES,
      required: true,
    },

    status: {
      type: String,
      enum: EVENT_STATUSES,
      default: "pending",
    },

    organizerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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

    address: {
      type: String,
      required: true,
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
      required: true,
    },

    bannerImage: {
      type: String,
      default: "",
    },

    galleryImages: {
      type: [String],
      default: [],
    },

    ticketTypes: {
      type: [ticketTypeSchema],
      required: true,
    },

    highlights: {
      type: [String],
      default: [],
    },

    rules: {
      type: [String],
      default: [],
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// const eventSchema = new Schema(
//   {
//     title: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     description: {
//       type: String,
//       required: true,
//     },
//     showType: {
//       type: String,
//       enum: ["event"],
//       default: "event",
//       immutable: true,
//     },
//     city: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     venue: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     venueId: {
//       type: String,
//       default: null,
//     },
//     startDateTime: {
//       type: Date,
//       required: true,
//     },
//     endDateTime: {
//       type: Date,
//     },
//     price: {
//       type: Number,
//       required: true,
//     },
//     totalSeats: {
//       type: Number,
//       required: true,
//     },
//     availableSeats: {
//       type: Number,
//       required: true,
//     },
//     organizer: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     imageUrl: {
//       type: String,
//       default: "",
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

export default mongoose.model("Event", eventSchema);
