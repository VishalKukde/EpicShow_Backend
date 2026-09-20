import express from "express";
import { getPublicSections } from "../controller/section.controller.js";

const router = express.Router();

// Public: the storefront reads this to know which sections accept bookings.
router.get("/sections", getPublicSections);

export default router;
