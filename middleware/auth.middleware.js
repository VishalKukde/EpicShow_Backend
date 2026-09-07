import jwt from "jsonwebtoken";
import User from "../modules/user/model/User.js";
import UserSession from "../modules/user/model/UserSession.js";

const authenticateViaRefreshToken = async (req, res, next) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id);
    const tokenVersion = Number(decoded?.tokenVersion ?? 0);

    if (!user || tokenVersion !== Number(user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    // Session check for multi-device login
    const session = await UserSession.findOne({
      $or: [
        { refreshToken },
        ...(decoded.sessionId ? [{ sessionId: decoded.sessionId }] : []),
      ],
      userId: user._id,
      status: "active",
    });

    if (!session) {
      return res.status(401).json({ message: "Session revoked or expired" });
    }

    // Update lastActiveAt periodically
    if (Date.now() - new Date(session.lastActiveAt).getTime() > 60000) {
      session.lastActiveAt = new Date();
      await session.save().catch(() => { });
    }

    req.user = user;
    req.sessionId = session.sessionId;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

const authMiddleware = async (req, res, next) => {
  let token = req.cookies.accessToken;

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
      return authenticateViaRefreshToken(req, res, next);
    }

    // Check session status if sessionId exists in access token
    if (decoded.sessionId) {
      const session = await UserSession.findOne({
        sessionId: decoded.sessionId,
        userId: user._id,
      });

      if (!session || session.status === "revoked") {
        return res.status(401).json({ message: "Session has been revoked" });
      }

      if (Date.now() - new Date(session.lastActiveAt).getTime() > 60000) {
        session.lastActiveAt = new Date();
        await session.save().catch(() => { });
      }

      req.sessionId = decoded.sessionId;
    }

    req.user = user;
    next();
  } catch {
    // If access token is invalid/expired but refresh token is valid, keep user authenticated.
    return authenticateViaRefreshToken(req, res, next);
  }
};

export default authMiddleware;
