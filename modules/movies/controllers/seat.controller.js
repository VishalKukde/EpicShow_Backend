import Seat from "../models/Seat.js";
import SeatStatus from "../models/SeatStatus.js";
import mongoose from "mongoose";

const PREMIUM_ROWS = new Set(["H", "I", "J"]);
const getSeatPrice = (rowLabel, basePrice) =>
  PREMIUM_ROWS.has(rowLabel) ? 320 : basePrice;

export const getSeatLayoutByCinemaId = async (req, res) => {
  try {
    const { cinemaId } = req.params;

    // From query params (frontend should send these)
    const { movieId, showDate, showSlot, userId } = req.query;

    // 1️⃣ Base seat layout (static layout of cinema)
    const cinema = await Seat.findOne({ cinemaId });

    if (!cinema) {
      return res.status(404).json({ message: "Cinema not found" });
    }

    const seatStatuses = await SeatStatus.find({
      movieId: new mongoose.Types.ObjectId(movieId.trim()),
      cinemaId: cinemaId.trim(),
      showDate: showDate.trim(),
      showSlot: showSlot.trim(),
      status: { $in: ["locked", "sold"] },
    });

    // 3️⃣ Create fast lookup map
    const statusMap = new Map();

    seatStatuses.forEach((s) => {
      if (s.status === "locked" && s.lockedBy === userId) {
        statusMap.set(s.seatId, "selected"); // user’s own lock
      } else {
        statusMap.set(s.seatId, s.status); // locked by others / sold
      }
    });

    // 4️⃣ Merge status into layout
    const mergedLayout = cinema.seats.map((row) => ({
      row: row.row,
      seats: row.seats.map((seat) => ({
        id: seat.seatId,
        number: Number(seat.number),
        price: getSeatPrice(row.row, seat.price),
        status: statusMap.get(seat.seatId) || "available",
      })),
    }));

    res.json(mergedLayout);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load seat layout" });
  }
};

export const lockSeat = async (req, res) => {
  try {
    const {
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatId,
      userId,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    if (!movieId || !cinemaId || !showDate || !showSlot || !seatId) {
      return res.status(400).json({ message: "Missing data" });
    }

    // 🟢 Check if this session already has locks
    const existingLock = await SeatStatus.findOne({
      movieId,
      cinemaId,
      showDate,
      showSlot,
      lockedBy: userId,
      status: "locked",
    });

    let expireTime;

    if (existingLock) {
      // 🔒 reuse same expiry
      expireTime = existingLock.expireAt;
    } else {
      // ⏱ first lock → start timer
      expireTime = new Date(Date.now() + 5 * 60 * 1000);
    }

    await SeatStatus.create({
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatId,
      status: "locked",
      lockedBy: userId,
      expireAt: expireTime,
    });

    res.json({
      success: true,
      expireAt: expireTime,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Seat already locked",
      });
    }

    console.error(err);
    res.status(500).json({ message: "Failed to lock seat" });
  }
};

export const unlockSeat = async (req, res) => {
  try {
    const {
      movieId,
      cinemaId,
      showDate,
      showSlot,
      seatId,
      userId,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    if (
      !movieId ||
      !cinemaId ||
      !showDate ||
      !showSlot ||
      !Array.isArray(seatId) ||
      seatId.length === 0
    ) {
      return res.status(400).json({ message: "Missing or invalid data" });
    }

    // ✅ Bulk delete
    const result = await SeatStatus.deleteMany({
      movieId: new mongoose.Types.ObjectId(movieId.trim()),
      cinemaId,
      showDate,
      showSlot,
      seatId: { $in: seatId },
      lockedBy: userId,
    });

    res.json({
      success: true,
      unlockedCount: result.deletedCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to unlock seats" });
  }
};
