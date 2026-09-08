import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Sport from "../models/Sport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.join(__dirname, "../data/sports.json");
const teamPlayersPath = path.join(__dirname, "../data/teamPlayer.json");

const loadSeedSports = async () => {
  try {
    const raw = await fs.readFile(dataPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadTeamPlayers = async () => {
  try {
    const raw = await fs.readFile(teamPlayersPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const seedSportsIfEmpty = async () => {
  try {
    const count = await Sport.countDocuments();
    if (count > 0) return;
    const seed = await loadSeedSports();
    if (!seed.length) return;
    const cleanSeed = seed.map(({ _id, ...item }) => item);
    await Sport.insertMany(cleanSeed, { ordered: false });
  } catch (err) {
    console.error("Failed to seed sports DB:", err.message);
  }
};

export const getSports = async (_req, res) => {
  try {
    await seedSportsIfEmpty();
    const sports = await Sport.find().sort({ createdAt: -1 });
    res.json(sports);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch sports." });
  }
};

export const getSportById = async (req, res) => {
  try {
    const sport = await Sport.findById(req.params.id);
    if (!sport) {
      return res.status(404).json({ message: "Sport match not found" });
    }
    res.json(sport);
  } catch (err) {
    res.status(404).json({ message: "Sport match not found" });
  }
};

export const getTeamPlayers = async (_req, res) => {
  try {
    const teams = await loadTeamPlayers();
    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch team players." });
  }
};

export const createSport = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    const created = await Sport.insertMany(items, { ordered: true });
    return res.status(201).json(Array.isArray(payload) ? created : created[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create sport event" });
  }
};

export const deleteSport = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Sport.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Sport event not found" });
    }
    return res.json({ message: "Sport event deleted successfully from database", id });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to delete sport event" });
  }
};
