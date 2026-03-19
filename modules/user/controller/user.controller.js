import User from "../model/User.js";

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
