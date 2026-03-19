import mongoose from "mongoose";

const SeatSchema = new mongoose.Schema({
  name: {
    type: String, // "PVR", "INOX", "Cinepolis"
    required: true,
  },
   
  cinemaId:{
  type: String,
  required: true,
  unique: true
  },

  // 💺 Seat layout for this cinema
  seats: [
    {
      row: {
        type: String, // A, B, C...
        required: true,
      },

      seats: [
        {
          seatId: {
            type: String, // A1, A2, B1...
            required: true,
          },

          number: {
            type: String, // "1", "2", "3"
            required: true,
          },

          price: {
            type: Number,
            required: true,
          }
        }
      ]
    }
  ]
});

export default mongoose.model("Seat_Layout", SeatSchema);