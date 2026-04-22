import "dotenv/config"; // ✅ this runs BEFORE imports

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import moviesRoutes from "./modules/movies/routes/movie.routes.js";
import userRoutes from "./modules/user/routes/user.routes.js";
import authRoutes from "./modules/auth/routes/auth.routes.js";
import seatRoutes from "./modules/movies/routes/seat.routes.js";
import paymentRoutes from "./modules/movies/routes/payment.routes.js";
import bookingRoutes from "./modules/movies/routes/booking.routes.js";
import walletRoutes from "./modules/wallet/routes/wallet.routes.js";
import tmdbRoutes from "./modules/movies/routes/tmdb.routes.js";
import sportsRoutes from "./modules/sports/routes/sport.routes.js";
import sportsPaymentRoutes from "./modules/sports/routes/payment.routes.js";
import sportsBookingRoutes from "./modules/sports/routes/booking.routes.js";
import eventRoutes from "./modules/event/routes/event.routes.js";
import eventBookingRoutes from "./modules/event/routes/booking.routes.js";
import eventPaymentRoutes from "./modules/event/routes/payment.routes.js";
import gamingRoutes from "./modules/gaming/routes/gaming.routes.js";
import gamingBookingRoutes from "./modules/gaming/routes/booking.routes.js";
import gamingPaymentRoutes from "./modules/gaming/routes/payment.routes.js";
import chatRoutes from "./modules/chat/routes/chat.routes.js";
import { initializeChatSocket } from "./modules/chat/socket/chat.socket.js";
import { initializeShowSocket } from "./modules/movies/socket/show.socket.js";
import errorHandler from "./middleware/error.middleware.js";
import { getRedisClient } from "./config/redis.js";

const app = express();
const port = process.env.PORT || 5000;
const MONGO_URIS = process.env.MONGO_URI;

// Connect to MongoDB
mongoose
  .connect(MONGO_URIS)
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.error("Error connecting to MongoDB:", error));

getRedisClient()
  .then(() => console.log("Connected to Redis"))
  .catch((error) => console.error("Error connecting to Redis:", error));

// CORS
const defaultOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins,  "https://epicshow.vercel.app"])];
const isProd = process.env.NODE_ENV === "production";

function isPrivateLanOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!isProd && isPrivateLanOrigin(origin)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Handle OPTIONS
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Health check (useful for warming up cold starts)
app.get(["/health", "/api/health"], (req, res) => {
  res.status(200).json({
    ok: true,
    service: "epicshow-backend",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongoReadyState: mongoose.connection.readyState,
  });
});

// Routes
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/profile", userRoutes);
app.use("/", moviesRoutes);
app.use("/", sportsRoutes);
app.use("/", sportsPaymentRoutes);
app.use("/", sportsBookingRoutes);
app.use("/", eventRoutes);
app.use("/", eventBookingRoutes);
app.use("/", eventPaymentRoutes);
app.use("/", gamingRoutes);
app.use("/", gamingBookingRoutes);
app.use("/", gamingPaymentRoutes);
app.use("/", seatRoutes);
app.use("/", paymentRoutes);
app.use("/", bookingRoutes);
app.use("/", walletRoutes);
app.use("/tmdb", tmdbRoutes);
app.use("/chat", chatRoutes);

// Error handler (LAST)
app.use(errorHandler);

// Wrap express for socket support.
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  },
});

initializeChatSocket(io);
initializeShowSocket(io);

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Start server
// app.listen(port, "0.0.0.0", () => {
//   console.log(`Server running at http://localhost:${port}`);
// });
