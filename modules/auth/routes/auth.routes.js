import express from "express";
const router = express.Router();
import {
  register,
  login,
  refresh,
  logout,
  changePassword,
  getSessions,
  revokeSession,
  revokeOtherSessions,
} from "../controller/auth.controller.js";
import requireAccessToken from "../../../middleware/requireAccessToken.middleware.js";

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.put(
  "/change-password",
  requireAccessToken,
  changePassword
);

// Multi-device session management routes
router.get("/sessions", requireAccessToken, getSessions);
router.delete("/sessions/other", requireAccessToken, revokeOtherSessions);
router.delete("/sessions/:sessionId", requireAccessToken, revokeSession);

export default router;
