import jwt from "jsonwebtoken";
import User from "../modules/user/model/User.js";

const authenticateViaRefreshToken = async (req, res, next) => {
  if (!req.cookies.refreshToken) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(
      req.cookies.refreshToken,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id);
    const tokenVersion = Number(decoded?.tokenVersion ?? 0);

    if (
      !user ||
      user.refreshToken !== req.cookies.refreshToken ||
      tokenVersion !== Number(user.tokenVersion ?? 0)
    ) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

const authMiddleware = async (req, res, next) => {
  let token;

  // 1️⃣ Try access token first
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  // 2️⃣ If no access token, try refresh token
  if (!token) {
    return authenticateViaRefreshToken(req, res, next);
  }

  // 3️⃣ Verify access token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    const tokenVersion = Number(decoded?.tokenVersion ?? 0);
    if (!user || tokenVersion !== Number(user.tokenVersion ?? 0)) {
      // Fallback to refresh-token auth if access token is stale.
      return authenticateViaRefreshToken(req, res, next);
    }
    req.user = user;
    next();
  } catch {
    // If access token is invalid/expired but refresh token is valid, keep user authenticated.
    return authenticateViaRefreshToken(req, res, next);
  }
};

export default authMiddleware;
