import jwt from "jsonwebtoken";
import User from "../modules/user/model/User.js";

export default async function requireAccessToken(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.split(" ")[1]
    : req.cookies.accessToken;

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    const tokenVersion = Number(decoded?.tokenVersion ?? 0);

    if (!user || tokenVersion !== Number(user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: "Access token expired. Please login again." });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid access token" });
  }
}
