import User from "../model/User.js";

const PAYMENT_METHODS = ["card", "upi", "wallet"];
const SEAT_PREFERENCES = {
  movieSeat: ["front", "middle", "back"],
  sportSeat: ["field_side", "center_view", "covered_upper"],
  trainSeat: ["window", "lower_berth", "aisle"],
  flightSeat: ["window", "aisle", "extra_legroom"],
};

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    phone: user.phone,
    lastLogin: user.lastLogin,
    role: user.role,
    membership: user.membership,
    walletBalance: user.walletBalance,
    preferences: user.preferences,
    rewardPoints: user.rewardPoints,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: serializeUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const generateProfileAvatarImage = async (req, res) => {
  try {
    const userPrompt = String(req.body?.prompt || "").trim();
    const prompt =
      userPrompt ||
      "Create a polished, modern, professional profile avatar for a user. Clean circular portrait, friendly face, neutral studio background, soft lighting, premium look, realistic style, centered composition, high detail, no text, no watermark.";

    const geminiKey = process.env.GEMINI_KEY;
    if (!geminiKey) {
      return res.status(500).json({ message: "Gemini API key is not configured." });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Create a clean, high-quality profile avatar illustration for a user. Keep it polished, friendly, and visually appealing. Use this prompt: ${prompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 32,
            topP: 0.9,
            maxOutputTokens: 2048,
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      const rawMessage = payload?.error?.message || "Failed to generate avatar.";
      const isQuotaError =
        response.status === 429 ||
        /quota exceeded|rate limit|too many requests|please retry in|free_tier_requests/i.test(rawMessage);

      return res.status(isQuotaError ? 429 : response.status || 500).json({
        message: isQuotaError
          ? "Image generation is temporarily unavailable. Please try again in a moment."
          : rawMessage,
      });
    }

    const imagePart = payload?.candidates?.[0]?.content?.parts?.find(
      (part) => part?.inlineData?.data && part?.inlineData?.mimeType
    );

    const imageData = imagePart?.inlineData?.data;
    const mimeType = imagePart?.inlineData?.mimeType || "image/png";

    if (!imageData) {
      return res.status(502).json({ message: "Gemini did not return a valid avatar image." });
    }

    return res.json({
      imageData: `data:${mimeType};base64,${imageData}`,
      message: "Avatar generated successfully.",
    });
  } catch (error) {
    console.error("AI avatar generation error:", error);
    return res.status(500).json({ message: error?.message || "Failed to generate avatar." });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id; // from auth middleware

    const { name, phone, avatar, preferences } = req.body;

    const updates = {};

    // Name validation
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }

      if (!/^[A-Za-z\s]+$/.test(name.trim())) {
        return res.status(400).json({ message: "Invalid name format" });
      }

      updates.name = name.trim();
    }

    // Phone validation
    if (phone !== undefined) {
      if (phone && !/^\d{10}$/.test(phone)) {
        return res.status(400).json({ message: "Phone must be 10 digits" });
      }

      updates.phone = phone;
    }

    // Avatar
    if (avatar !== undefined) {
      updates.avatar = avatar;
    }

    // Preferences
    if (preferences !== undefined) {
      if (typeof preferences !== "object" || preferences === null) {
        return res.status(400).json({ message: "Invalid preferences payload" });
      }

      if (preferences.darkMode !== undefined) {
        if (typeof preferences.darkMode !== "boolean") {
          return res.status(400).json({ message: "darkMode must be a boolean" });
        }
        updates["preferences.darkMode"] = preferences.darkMode;
      }

      if (preferences.notifications !== undefined) {
        if (typeof preferences.notifications !== "boolean") {
          return res.status(400).json({ message: "notifications must be a boolean" });
        }
        updates["preferences.notifications"] = preferences.notifications;
      }

      if (preferences.seat !== undefined) {
        if (typeof preferences.seat !== "object" || preferences.seat === null) {
          return res.status(400).json({ message: "Invalid seat preferences payload" });
        }

        for (const [field, allowedValues] of Object.entries(SEAT_PREFERENCES)) {
          const value = preferences.seat[field];
          if (value !== undefined) {
            if (!allowedValues.includes(value)) {
              return res.status(400).json({ message: `Unsupported ${field} preference` });
            }
            updates[`preferences.seat.${field}`] = value;
          }
        }
      }

      if (preferences.payment !== undefined) {
        if (typeof preferences.payment !== "object" || preferences.payment === null) {
          return res.status(400).json({ message: "Invalid payment preferences payload" });
        }

        const currentUser = await User.findById(userId).select("preferences.payment");
        if (!currentUser) {
          return res.status(404).json({ message: "User not found" });
        }

        const currentPayment = currentUser.preferences?.payment || {};
        const nextPreferredMethod =
          preferences.payment.preferredMethod ?? currentPayment.preferredMethod ?? "card";
        const nextDisabledMethods = {
          card: Boolean(currentPayment.disabledMethods?.card),
          upi: Boolean(currentPayment.disabledMethods?.upi),
          wallet: Boolean(currentPayment.disabledMethods?.wallet),
        };

        if (preferences.payment.disabledMethods !== undefined) {
          if (
            typeof preferences.payment.disabledMethods !== "object" ||
            preferences.payment.disabledMethods === null
          ) {
            return res.status(400).json({ message: "Invalid disabled payment methods payload" });
          }

          for (const method of PAYMENT_METHODS) {
            const value = preferences.payment.disabledMethods[method];
            if (value !== undefined) {
              if (typeof value !== "boolean") {
                return res.status(400).json({ message: `${method} disabled flag must be a boolean` });
              }
              nextDisabledMethods[method] = value;
              updates[`preferences.payment.disabledMethods.${method}`] = value;
            }
          }
        }

        if (preferences.payment.preferredMethod !== undefined) {
          if (!PAYMENT_METHODS.includes(preferences.payment.preferredMethod)) {
            return res.status(400).json({ message: "Unsupported preferred payment method" });
          }
          updates["preferences.payment.preferredMethod"] = preferences.payment.preferredMethod;
        }

        if (preferences.payment.lastUsedMethod !== undefined) {
          if (!PAYMENT_METHODS.includes(preferences.payment.lastUsedMethod)) {
            return res.status(400).json({ message: "Unsupported last used payment method" });
          }
          updates["preferences.payment.lastUsedMethod"] = preferences.payment.lastUsedMethod;
        }

        if (nextDisabledMethods[nextPreferredMethod]) {
          return res.status(400).json({
            message: "You cannot disable your preferred payment method. Choose another preferred method first.",
          });
        }

        if (Object.values(nextDisabledMethods).every(Boolean)) {
          return res.status(400).json({ message: "At least one payment method must stay enabled." });
        }
      }
    }

    const user = await User.findByIdAndUpdate(userId, updates, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user: serializeUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
