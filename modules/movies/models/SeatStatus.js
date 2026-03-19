import mongoose from "mongoose";

const SeatStatusSchema = new mongoose.Schema({

  movieId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Movie",
    required: true
  },

  cinemaId: {
    type: String,
    ref: "Cinema",
    required: true
  },

  showDate: {
    type: String,   // "2026-02-10"
    required: true
  },

  showSlot: {
    type: String,   // "10:00 AM", "2:00 PM", "6:00 PM"
    required: true
  },

  seatId: {
    type: String,   // "A1", "B10"
    required: true
  },

  status: {
    type: String,
    enum: ["locked", "sold"],
    required: true
  },

  lockedBy: {
  type: String,   // userId 
  required: true
},

  createdAt: {
    type: Date,
    default: Date.now
  },

  expireAt: {
    type: Date   // only used when status = locked
  }

});


// ✅ Prevent double booking for same show
SeatStatusSchema.index(
  { movieId: 1, cinemaId: 1, showDate: 1, showSlot: 1, seatId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["locked", "sold"] }
    }
  }
);


// ✅ Auto delete expired locks
SeatStatusSchema.index(
  { expireAt: 1 },
  { expireAfterSeconds: 0 }
);

export default mongoose.model("SeatStatus", SeatStatusSchema);
