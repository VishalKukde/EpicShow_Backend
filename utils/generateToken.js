import jwt from "jsonwebtoken";

export const generateAccessToken = (user, expiresIn = "15m", sessionId = null) => {
  const userId = user?._id || user?.id || user;
  const tokenVersion = Number(user?.tokenVersion ?? 0);
  const payload = { id: userId, tokenVersion, type: "access" };
  if (sessionId) payload.sessionId = sessionId;

  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

export const generateRefreshToken = (user, expiresIn = "7d", sessionId = null) => {
  const userId = user?._id || user?.id || user;
  const tokenVersion = Number(user?.tokenVersion ?? 0);
  const payload = { id: userId, tokenVersion, type: "refresh" };
  if (sessionId) payload.sessionId = sessionId;

  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET,
    { expiresIn }
  );
};
