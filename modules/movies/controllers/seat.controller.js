import Seat from "../models/Seat.js";
import BookedSeat from "../models/BookedSeat.js";
import {
  acquireSeatLock,
  forceReleaseSeatLocks,
  getSeatLockOwners,
  releaseSeatLocks,
} from "../services/seat-lock.service.js";
import { emitSeatLocked, emitSeatUnlocked } from "../socket/show.socket.js";
import { buildShowId, normalizeString, toIdString } from "../utils/show.utils.js";

const PREMIUM_ROWS = new Set(["H", "I", "J"]);

const getSeatPrice = (rowLabel, basePrice) =>
  PREMIUM_ROWS.has(rowLabel) ? 320 : basePrice;

const resolveShowPayload = ({ movieId, itemId, eventId, cinemaId, showDate, showSlot }) => {
  const resolvedItemId = toIdString(itemId || eventId || movieId);
  const resolvedCinemaId = normalizeString(cinemaId);
  const resolvedShowDate = normalizeString(showDate);
  const resolvedShowSlot = normalizeString(showSlot);

  return {
    itemId: resolvedItemId,
    cinemaId: resolvedCinemaId,
    showDate: resolvedShowDate,
    showSlot: resolvedShowSlot,
    showId: buildShowId({
      itemId: resolvedItemId,
      cinemaId: resolvedCinemaId,
      showDate: resolvedShowDate,
      showSlot: resolvedShowSlot,
    }),
  };
};

export const getSeatLayoutByCinemaId = async (req, res) => {
  try {
    const { cinemaId } = req.params;
    const { movieId, itemId, eventId, showDate, showSlot, userId } = req.query;

    const showContext = resolveShowPayload({
      movieId,
      itemId,
      eventId,
      cinemaId,
      showDate,
      showSlot,
    });

    if (!showContext.showId) {
      return res.status(400).json({ message: "Missing show details" });
    }

    const cinema = await Seat.findOne({ cinemaId: normalizeString(cinemaId) }).lean();

    if (!cinema) {
      return res.status(404).json({ message: "Cinema not found" });
    }

    const allSeatIds = cinema.seats.flatMap((row) =>
      row.seats.map((seat) => normalizeString(seat.seatId))
    );

    const [bookedSeats, lockOwners] = await Promise.all([
      BookedSeat.find({ showId: showContext.showId }).select("seatId").lean(),
      getSeatLockOwners({ showId: showContext.showId, seatIds: allSeatIds }),
    ]);

    const bookedSeatIds = new Set(bookedSeats.map((seat) => normalizeString(seat.seatId)));
    const currentUserId = toIdString(userId);

    const mergedLayout = cinema.seats.map((row) => ({
      row: row.row,
      seats: row.seats.map((seat) => {
        const seatId = normalizeString(seat.seatId);
        const lockOwner = lockOwners.get(seatId);

        let status = "available";
        if (bookedSeatIds.has(seatId)) {
          status = "sold";
        } else if (lockOwner && lockOwner === currentUserId) {
          status = "selected";
        } else if (lockOwner) {
          status = "locked";
        }

        return {
          id: seatId,
          number: Number(seat.number),
          price: getSeatPrice(row.row, seat.price),
          status,
        };
      }),
    }));

    res.json(mergedLayout);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load seat layout" });
  }
};

export const lockSeat = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id || req.body.userId || req.body.user);
    const { movieId, itemId, eventId, cinemaId, showDate, showSlot, seatId } = req.body;
    const normalizedSeatId = normalizeString(seatId);

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    const showContext = resolveShowPayload({
      movieId,
      itemId,
      eventId,
      cinemaId,
      showDate,
      showSlot,
    });

    if (!showContext.showId || !normalizedSeatId) {
      return res.status(400).json({ message: "Missing data" });
    }

    const alreadyBooked = await BookedSeat.exists({
      showId: showContext.showId,
      seatId: normalizedSeatId,
    });

    if (alreadyBooked) {
      return res.status(409).json({ message: "Seat already locked or booked" });
    }

    const lockResult = await acquireSeatLock({
      showId: showContext.showId,
      seatId: normalizedSeatId,
      userId,
    });

    if (!lockResult.acquired) {
      return res.status(409).json({ message: "Seat already locked or booked" });
    }

    const bookedAfterLock = await BookedSeat.exists({
      showId: showContext.showId,
      seatId: normalizedSeatId,
    });

    if (bookedAfterLock) {
      await forceReleaseSeatLocks({
        showId: showContext.showId,
        seatIds: [normalizedSeatId],
      });

      return res.status(409).json({ message: "Seat already locked or booked" });
    }

    await emitSeatLocked({
      showId: showContext.showId,
      seatIds: [normalizedSeatId],
      userId,
      expireAt: lockResult.expireAt,
    });

    return res.json({
      success: true,
      showId: showContext.showId,
      expireAt: lockResult.expireAt,
      seatIds: [normalizedSeatId],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to lock seat" });
  }
};

export const unlockSeat = async (req, res) => {
  try {
    const userId = toIdString(req.user?.id || req.body.userId || req.body.user);
    const { movieId, itemId, eventId, cinemaId, showDate, showSlot, seatId } = req.body;
    const seatIds = Array.isArray(seatId)
      ? seatId.map((value) => normalizeString(value)).filter(Boolean)
      : [];

    if (!userId) {
      return res.status(400).json({ message: "Missing user id" });
    }

    const showContext = resolveShowPayload({
      movieId,
      itemId,
      eventId,
      cinemaId,
      showDate,
      showSlot,
    });

    if (!showContext.showId || seatIds.length === 0) {
      return res.status(400).json({ message: "Missing or invalid data" });
    }

    const unlockedSeatIds = await releaseSeatLocks({
      showId: showContext.showId,
      seatIds,
      userId,
    });

    if (unlockedSeatIds.length > 0) {
      await emitSeatUnlocked({
        showId: showContext.showId,
        seatIds: unlockedSeatIds,
        userId,
        reason: "manual",
      });
    }

    res.json({
      success: true,
      showId: showContext.showId,
      unlockedCount: unlockedSeatIds.length,
      seatIds: unlockedSeatIds,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to unlock seats" });
  }
};
