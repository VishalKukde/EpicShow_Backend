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
import {
  activateAdminTotp,
  adminLogin,
  disableAdminTotp,
  getAdminTotpStatus,
  startAdminTotpSetup,
} from "../controller/admin-auth.controller.js";
import { adminAuthThrottle } from "../middleware/adminThrottle.middleware.js";

router.post("/register", register);
router.post("/login", login);

// Admin sign-in: email + password + authenticator code, all required.
router.post("/admin/login", adminAuthThrottle, adminLogin);
router.post("/admin/totp/setup", adminAuthThrottle, startAdminTotpSetup);
router.post("/admin/totp/activate", adminAuthThrottle, activateAdminTotp);

// Managed from the admin's own security page, so these need a live session.
router.get("/admin/totp/status", requireAccessToken, getAdminTotpStatus);
router.post("/admin/totp/disable", requireAccessToken, adminAuthThrottle, disableAdminTotp);
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
