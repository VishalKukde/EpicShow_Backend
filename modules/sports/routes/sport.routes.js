import express from "express";
import { createSport, getSportById, getSports, getTeamPlayers } from "../controllers/sport.controller.js";
import authMiddleware from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/sports/teams", getTeamPlayers);
router.get("/sports", getSports);
router.get("/sports/:id", getSportById);
router.post("/sports", authMiddleware, createSport);

export default router;
