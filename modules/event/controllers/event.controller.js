import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Event from "../models/Event.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.join(__dirname, "../data/events.json");

const loadSeedEvents = async () => {
  try {
    const raw = await fs.readFile(seedPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const seedEventsIfEmpty = async () => {
  const count = await Event.countDocuments();
  if (count > 0) return;
  const seed = await loadSeedEvents();
  if (!seed.length) return;
  const normalized = seed.map((item) => ({
    ...item,
    showType: item.showType || "event",
    startDateTime: new Date(item.startDateTime),
    endDateTime: item.endDateTime ? new Date(item.endDateTime) : undefined,
    imageUrl:
      typeof item.imageUrl === "string"
        ? item.imageUrl.trim().replace(/^\/public\//, "/")
        : "",
  }));
  await Event.insertMany(normalized, { ordered: true });
};

const backfillEventImages = async (events) => {
  if (!events || events.length === 0) return;
  const seed = await loadSeedEvents();
  if (!seed.length) return;

  const imageMap = new Map(
    seed
      .filter((item) => item && item.title && item.imageUrl)
      .map((item) => [item.title, item.imageUrl])
  );

  const updates = events
    .map((event) => {
      const current = typeof event.imageUrl === "string" ? event.imageUrl.trim() : "";
      const normalized = current.replace(/^\/public\//, "/");
      const fallback = imageMap.get(event.title);

      if (!normalized && fallback) {
        event.imageUrl = fallback;
        return event.save();
      }

      if (normalized && normalized !== current) {
        event.imageUrl = normalized;
        return event.save();
      }

      return null;
    })
    .filter(Boolean);

  if (updates.length) {
    await Promise.allSettled(updates);
  }
};

export const getEvents = async (req, res) => {
  try {
    await seedEventsIfEmpty();
    const events = await Event.find().sort({ startDateTime: 1 });
    await backfillEventImages(events);
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch events" });
  }
};

export const getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    await backfillEventImages([event]);
    res.json(event);
  } catch (err) {
    res.status(404).json({ message: "Event not found" });
  }
};

export const createEvent = async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];

    const normalizeEvent = (raw) => {
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

      return {
        title: title.trim(),
        description: description.trim(),
        showType: showType || "event",
        city: city.trim(),
        venue: venue.trim(),
        venueId: venueId || null,
        startDateTime: startDateValue,
        ...(endDateValue ? { endDateTime: endDateValue } : {}),
        price: Number(price),
        totalSeats: Number(totalSeats),
        availableSeats: Number(availableSeats),
        organizer: organizer.trim(),
        imageUrl: typeof imageUrl === "string" ? imageUrl.trim() : "",
      };
    };

    const normalized = items.map(normalizeEvent);
    const invalidIndex = normalized.findIndex((item) => item && item.error);

    if (invalidIndex !== -1) {
      const invalid = normalized[invalidIndex];
      return res.status(400).json({
        message: `Missing or invalid fields in item ${invalidIndex + 1}: ${invalid.error.join(", ")}`,
      });
    }

    const created = await Event.insertMany(normalized, { ordered: true });
    return res.status(201).json(Array.isArray(payload) ? created : created[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to create event" });
  }
};
