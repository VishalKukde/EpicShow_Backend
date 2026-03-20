// import mongoose, { Schema } from "mongoose";

// const priceSchema = new Schema(
//   {
//     standard: {
//       type: Number,
//       required: true,
//       min: 0,
//     },
//     premium: {
//       type: Number,
//       required: true,
//       min: 0,
//     },
//     vip: {
//       type: Number,
//       required: true,
//       min: 0,
//     },
//   },
//   { _id: false }
// );

// const sportSchema = new Schema(
//   {
//     sportType: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     league: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     matchNo: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     teamA: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     teamB: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     date: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     time: {
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
//       required: true,
//       trim: true,
//     },
//     city: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     imageUrl: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     description: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     durationMinutes: {
//       type: Number,
//       required: true,
//       min: 1,
//     },
//     rating: {
//       type: Number,
//       required: true,
//       min: 0,
//       max: 10,
//     },
//     language: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     genres: {
//       type: [String],
//       default: [],
//     },
//     prices: {
//       type: priceSchema,
//       required: true,
//     },
//   },
//   { timestamps: true }
// );

// export default mongoose.model("Sports", sportSchema);
