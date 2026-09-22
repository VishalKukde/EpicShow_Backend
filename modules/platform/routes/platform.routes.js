import express from "express";
import { getPublicPlatformSettings } from "../controller/platform.controller.js";

const router = express.Router();

// Public: the storefront reads the announcement and seat limits from this.
router.get("/platform-settings", getPublicPlatformSettings);

export default router;
