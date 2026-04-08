import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Gaming from "../models/Gaming.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.join(__dirname, "../data/gaming.json");

const loadSeedGaming = async () => {
  try {
    const raw = await fs.readFile(seedPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeImageUrl = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^\/public\//, "/");
};

const seedGamingIfEmpty = async () => {
  const count = await Gaming.countDocuments();
  if (count > 0) return;
  const seed = await loadSeedGaming();
  if (!seed.length) return;
  const normalized = seed.map((item) => {
    const imageUrl = normalizeImageUrl(item.imageUrl);
    return {
      ...item,
      showType: item.showType || "gaming",
      startDateTime: new Date(item.startDateTime),
      endDateTime: item.endDateTime ? new Date(item.endDateTime) : undefined,
      ...(imageUrl ? { imageUrl } : {}),
    };
  });
  await Gaming.insertMany(normalized, { ordered: true });
};

export const getGaming = async (req, res) => {
  try {
    await seedGamingIfEmpty();
    const items = await Gaming.find().sort({ startDateTime: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch gaming shows" });
  }
};

export const getGamingById = async (req, res) => {
  try {
    const item = await Gaming.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ message: "Gaming show not found" });
    }
    res.json(item);
  } catch (err) {
    res.status(404).json({ message: "Gaming show not found" });
  }
};

export const createGaming = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];

    const normalizeGaming = (raw) => {
      const {
        title,
        description,
        showType,
        city,
        venue,
        venueId,
        startDateTime,
        endDateTime,
        price,
        totalSeats,
        availableSeats,
        organizer,
        imageUrl,
      } = raw || {};

      const missing = [];
      if (!title || typeof title !== "string" || !title.trim()) missing.push("title");
      if (!description || typeof description !== "string" || !description.trim()) {
        missing.push("description");
      }
      if (!city || typeof city !== "string" || !city.trim()) missing.push("city");
      if (!venue || typeof venue !== "string" || !venue.trim()) missing.push("venue");
      if (!organizer || typeof organizer !== "string" || !organizer.trim()) {
        missing.push("organizer");
      }
      if (price === undefined || Number.isNaN(Number(price))) missing.push("price");
      if (totalSeats === undefined || Number.isNaN(Number(totalSeats))) {
        missing.push("totalSeats");
      }
      if (availableSeats === undefined || Number.isNaN(Number(availableSeats))) {
        missing.push("availableSeats");
      }

      let startDateValue;
      if (startDateTime === undefined || startDateTime === null || String(startDateTime).trim() === "") {
        missing.push("startDateTime");
      } else {
        const parsed = new Date(startDateTime);
        if (Number.isNaN(parsed.getTime())) {
          missing.push("startDateTime");
        } else {
          startDateValue = parsed;
        }
      }

      let endDateValue;
      if (endDateTime !== undefined && endDateTime !== null && String(endDateTime).trim() !== "") {
        const parsed = new Date(endDateTime);
        if (Number.isNaN(parsed.getTime())) {
          missing.push("endDateTime");
        } else {
          endDateValue = parsed;
        }
      }

      if (missing.length > 0) {
        return { error: missing };
      }

      const normalizedImageUrl = normalizeImageUrl(imageUrl);

      return {
        title: title.trim(),
        description: description.trim(),
        showType: showType || "gaming",
        city: city.trim(),
        venue: venue.trim(),
        venueId: venueId || null,
        startDateTime: startDateValue,
        ...(endDateValue ? { endDateTime: endDateValue } : {}),
        price: Number(price),
        totalSeats: Number(totalSeats),
        availableSeats: Number(availableSeats),
        organizer: organizer.trim(),
        ...(normalizedImageUrl ? { imageUrl: normalizedImageUrl } : {}),
      };
    };

    const normalized = items.map(normalizeGaming);
    const invalidIndex = normalized.findIndex((item) => item && item.error);

    if (invalidIndex !== -1) {
      const invalid = normalized[invalidIndex];
      return res.status(400).json({
        message: `Missing or invalid fields in item ${invalidIndex + 1}: ${invalid.error.join(", ")}`,
      });
    }

    const created = await Gaming.insertMany(normalized, { ordered: true });
    return res.status(201).json(Array.isArray(payload) ? created : created[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create gaming show" });
  }
};
