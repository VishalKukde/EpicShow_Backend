import Feedback from "../models/Feedback.js";

const ALLOWED_CATEGORIES = new Set([
  "Booking Experience",
  "Payments",
  "App Performance",
  "UI and Design",
  "Feature Request",
  "Support",
  "Other",
]);

const MIN_MESSAGE_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 500;

const normalizeMessage = (value) => String(value || "").trim().replace(/\s+/g, " ");

const buildFeedbackDto = (feedback) => ({
  id: String(feedback._id),
  userName: feedback.userName,
  category: feedback.category,
  rating: feedback.rating,
  message: feedback.message,
  displayMessage: feedback.displayMessage || feedback.message,
  isPublic: feedback.isPublic,
  isFeatured: feedback.isFeatured,
  createdAt: feedback.createdAt,
});

export const createFeedback = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const userName = String(req.user?.name || "").trim();
    const category = String(req.body.category || "").trim();
    const rating = Number(req.body.rating);
    const message = normalizeMessage(req.body.message);
    const isPublic = Boolean(req.body.isPublic);

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!userName) {
      return res.status(400).json({ message: "Profile name is required" });
    }

    if (!ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({ message: "Please choose a valid feedback category" });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    if (message.length < MIN_MESSAGE_LENGTH) {
      return res.status(400).json({
        message: `Feedback must be at least ${MIN_MESSAGE_LENGTH} characters`,
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        message: `Feedback must be ${MAX_MESSAGE_LENGTH} characters or less`,
      });
    }

    const feedback = await Feedback.create({
      userId,
      userName,
      category,
      rating,
      message,
      displayMessage: isPublic ? message : undefined,
      isPublic,
      isFeatured: false,
    });

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
      feedback: buildFeedbackDto(feedback),
    });
  } catch (error) {
    console.error("Create feedback error:", error);
    res.status(500).json({ message: "Failed to submit feedback" });
  }
};

export const getMyFeedback = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const feedback = await Feedback.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      feedback: feedback.map(buildFeedbackDto),
    });
  } catch (error) {
    console.error("Get feedback error:", error);
    res.status(500).json({ message: "Failed to load feedback" });
  }
};

export const getTestimonials = async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 100)
      : 24;

    const feedback = await Feedback.find({
      isPublic: true,
      rating: { $gte: 4 },
    })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(limit)
      .select("userName category rating message displayMessage isFeatured createdAt")
      .lean();

    res.json({
      success: true,
      testimonials: feedback.map(buildFeedbackDto),
    });
  } catch (error) {
    console.error("Get testimonials error:", error);
    res.status(500).json({ message: "Failed to load testimonials" });
  }
};
