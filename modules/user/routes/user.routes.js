import express from "express";
import { getCurrentUser, updateProfile } from "../controller/user.controller.js";
import auth from "../../../middleware/auth.middleware.js";

const router = express.Router();

router.get("/me", auth, getCurrentUser);
router.put("/update-profile", auth, updateProfile);

export default router;
