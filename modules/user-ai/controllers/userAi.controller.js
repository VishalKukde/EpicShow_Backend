import jwt from "jsonwebtoken";
import User from "../../user/model/User.js";
import { streamChatResponse } from "../services/userAi.service.js";

/**
 * Optional authentication middleware:
 * Attaches req.user if a valid token is present; proceeds as guest (req.user = null) otherwise.
 */
export async function optionalAuth(req, res, next) {
  let token = null;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.id) {
      const user = await User.findById(decoded.id).select("-password").lean();
      req.user = user || null;
    }
  } catch {
    // If access token is expired, try refresh token if present
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken && process.env.JWT_REFRESH_SECRET) {
      try {
        const decodedRefresh = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        if (decodedRefresh?.id) {
          const user = await User.findById(decodedRefresh.id).select("-password").lean();
          req.user = user || null;
        }
      } catch {
        req.user = null;
      }
    } else {
      req.user = null;
    }
  }

  next();
}

/**
 * SSE Streaming controller for User AI chat
 */
export async function handleChatStream(req, res) {
  const { message, history } = req.body || {};
  // console.log("[User AI Controller] Incoming chat message:", message);

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  // Set Server-Sent Events headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let isAborted = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      isAborted = true;
    }
  });

  await streamChatResponse({
    message: message.trim(),
    history: Array.isArray(history) ? history : [],
    user: req.user || null,
    onChunk: (chunk) => {
      if (!isAborted) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    },
    onDone: () => {
      if (!isAborted) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    },
    onError: (err) => {
      console.error("[User AI Controller] Error streaming response:", err.message);
      if (!isAborted) {
        res.write(
          `data: ${JSON.stringify({
            chunk: " I am currently experiencing an issue retrieving that information. Please try again in a moment.",
          })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
      }
    },
  });
}

/**
 * Health check endpoint
 */
export function handleHealthCheck(req, res) {
  res.json({
    status: "ok",
    module: "user-ai",
    timestamp: new Date().toISOString(),
  });
}
