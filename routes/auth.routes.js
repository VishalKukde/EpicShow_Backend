import express from "express";
const router = express.Router();
import {
  register,
  login,
  refresh,
  logout,
  changePassword,
} from "../controller/auth.controller.js";
import changePasswordRateLimit from "../middleware/changePasswordRateLimit.middleware.js";
import requireAccessToken from "../middleware/requireAccessToken.middleware.js";

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.put(
  "/change-password",
  requireAccessToken,
  // changePasswordRateLimit, //enabled this in production
  changePassword
);

export default router;
