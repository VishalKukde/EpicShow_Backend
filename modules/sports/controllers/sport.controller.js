import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.join(__dirname, "../data/sports.json");
const teamPlayersPath = path.join(__dirname, "../data/teamPlayer.json");

const loadSportsData = async () => {
  const raw = await fs.readFile(dataPath, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
};

const loadTeamPlayers = async () => {
  const raw = await fs.readFile(teamPlayersPath, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
};

export const getSports = async (_req, res) => {
  try {
    const sports = await loadSportsData();
    res.json(sports);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch sports." });
  }
};

export const getSportById = async (req, res) => {
  try {
    const sports = await loadSportsData();
    const sport = sports.find((item) => item && item._id === req.params.id);
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
    res
      .status(500)
      .json({ message: err.message || "Failed to fetch team players." });
  }
};

export const createSport = async (req, res) => {
  void req;
  return res.status(405).json({
    message: "Sports data is read-only and managed via local JSON.",
  });
};
