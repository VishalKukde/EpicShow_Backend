import mongoose, { Schema } from "mongoose";

const priceSchema = new Schema(
    {
        standard: {
            type: Number,
            default: 300,
        },
        premium: {
            type: Number,
            default: 450,
        },
        vip: {
            type: Number,
            default: 600,
        },
    },
    { _id: false }
);

const sportSchema = new Schema(
    {
        sportType: {
            type: String,
            default: "Cricket",
            trim: true,
        },
        league: {
            type: String,
            required: true,
            trim: true,
        },
        matchNo: {
            type: String,
            default: "Match 1",
            trim: true,
        },
        teamA: {
            type: String,
            required: true,
            trim: true,
        },
        teamB: {
            type: String,
            required: true,
            trim: true,
        },
        date: {
            type: String,
            required: true,
            trim: true,
        },
        time: {
            type: String,
            default: "07:30 PM",
            trim: true,
        },
        venue: {
            type: String,
            required: true,
            trim: true,
        },
        venueId: {
            type: String,
            default: "stadium_main",
            trim: true,
        },
        city: {
            type: String,
            required: true,
            trim: true,
        },
        imageUrl: {
            type: String,
            default: "",
            trim: true,
        },
        description: {
            type: String,
            default: "Exciting sports match.",
            trim: true,
        },
        durationMinutes: {
            type: Number,
            default: 205,
        },
        rating: {
            type: Number,
            default: 4.5,
        },
        language: {
            type: String,
            default: "Hindi",
            trim: true,
        },
        genres: {
            type: [String],
            default: ["Cricket", "IPL"],
        },
        prices: {
            type: priceSchema,
            default: () => ({ standard: 300, premium: 450, vip: 600 }),
        },
    },
    { timestamps: true }
);

export default mongoose.model("Sports", sportSchema);
