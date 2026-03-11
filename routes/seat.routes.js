import express from "express";
import { getSeatLayoutByCinemaId, lockSeat, unlockSeat} from "../controller/seat.controller.js"
import authMiddleware from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/seat/:cinemaId", getSeatLayoutByCinemaId);
router.post("/seat/lock", authMiddleware, lockSeat);
router.post("/seat/unlock", authMiddleware, unlockSeat);

export default router;
