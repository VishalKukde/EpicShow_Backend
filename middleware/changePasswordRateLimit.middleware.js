import PasswordChangeAttempt from "../models/PasswordChangeAttempt.js";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export default async function changePasswordRateLimit(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const windowStart = new Date(Date.now() - WINDOW_MS);
    const attempts = await PasswordChangeAttempt.countDocuments({
      user: userId,
      createdAt: { $gte: windowStart },
    });

    if (attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({
        message: "Too many attempts. Please try again after 15 minutes.",
      });
    }

    await PasswordChangeAttempt.create({ user: userId });
    return next();
  } catch (error) {
    console.error("changePasswordRateLimit error:", error);
    return res.status(500).json({ message: "Rate limit check failed" });
  }
}
