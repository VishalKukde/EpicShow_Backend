import mongoose from "mongoose";
import Coupon from "../../offers/model/Coupon.js";
import UserCoupon from "../../offers/model/UserCoupon.js";
import User from "../../user/model/User.js";

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin access required" });
    return false;
  }
  return true;
}

const mapCategoryToBookingTypes = (category) => {
  if (!category) return ["movie", "event", "sport", "gaming"];
  const lower = String(category).trim().toLowerCase();
  if (lower.includes("movie")) return ["movie"];
  if (lower.includes("sport")) return ["sport"];
  if (lower.includes("gaming")) return ["gaming"];
  if (lower.includes("event")) return ["event"];
  if (lower.includes("train") || lower.includes("transit")) return ["train"];
  return ["movie", "event", "sport", "gaming"];
};

export const getAdminCoupons = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();

    // Aggregate user allocation and redemption statistics
    const statsAgg = await UserCoupon.aggregate([
      {
        $group: {
          _id: { $toString: "$couponId" },
          allocatedCount: { $sum: 1 },
          usedCount: {
            $sum: { $cond: [{ $eq: ["$status", "USED"] }, 1, 0] },
          },
        },
      },
    ]);

    const statsMap = new Map();
    statsAgg.forEach((s) => {
      statsMap.set(String(s._id), s);
    });

    const now = new Date();
    const enrichedCoupons = coupons.map((c) => {
      const cIdStr = String(c._id);
      const stat = statsMap.get(cIdStr) || { allocatedCount: 0, usedCount: 0 };
      const isExpired = c.validTill && new Date(c.validTill) < now;
      const status = isExpired ? "expired" : c.status;

      return {
        ...c,
        id: c._id,
        status,
        allocatedCount: stat.allocatedCount,
        usedCount: Math.max(c.usedCount || 0, stat.usedCount),
      };
    });

    const activeCount = enrichedCoupons.filter((c) => c.status === "active").length;
    const totalRedemptions = enrichedCoupons.reduce((acc, c) => acc + (c.usedCount || 0), 0);
    const totalAllocations = enrichedCoupons.reduce((acc, c) => acc + (c.allocatedCount || 0), 0);

    return res.status(200).json({
      success: true,
      coupons: enrichedCoupons,
      stats: {
        activeCount,
        totalRedemptions,
        totalAllocations,
        totalCoupons: enrichedCoupons.length,
      },
    });
  } catch (error) {
    console.error("getAdminCoupons error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load admin coupons",
      error: error.message,
    });
  }
};

export const createAdminCoupon = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const {
      code,
      title,
      description,
      discountType,
      value,
      discountValue,
      maxDiscount,
      minAmount,
      minOrderAmount,
      validTill,
      expiryDate,
      startDate,
      applicableBookingTypes,
      applicableCategory,
      usageLimit,
      maxUsageLimit,
      categoryId,
      categoryTitle,
    } = req.body;

    const normalizedCode = String(code || "").toUpperCase().trim();
    if (!normalizedCode) {
      return res.status(400).json({ success: false, message: "Coupon code is required" });
    }

    const existingCoupon = await Coupon.findOne({ code: normalizedCode });
    if (existingCoupon) {
      return res.status(409).json({
        success: false,
        message: `Coupon code "${normalizedCode}" already exists`,
      });
    }

    const rawDiscountType = String(discountType || "").toUpperCase();
    const resolvedDiscountType =
      rawDiscountType === "PERCENT" || rawDiscountType === "PERCENTAGE"
        ? "PERCENT"
        : "FLAT";

    const resolvedValue = Number(value ?? discountValue ?? 0);
    if (!resolvedValue || resolvedValue <= 0) {
      return res.status(400).json({
        success: false,
        message: "A positive discount value is required",
      });
    }

    const resolvedExpiry = validTill || expiryDate;
    if (!resolvedExpiry) {
      return res.status(400).json({
        success: false,
        message: "Expiry date is required",
      });
    }

    const resolvedMinAmount = Number(minAmount ?? minOrderAmount ?? 0);
    const resolvedLimit = Number(usageLimit ?? maxUsageLimit ?? 1000);

    let resolvedBookingTypes = applicableBookingTypes;
    if (!resolvedBookingTypes || !Array.isArray(resolvedBookingTypes) || !resolvedBookingTypes.length) {
      resolvedBookingTypes = mapCategoryToBookingTypes(applicableCategory);
    }

    const coupon = new Coupon({
      code: normalizedCode,
      title: title || `${normalizedCode} Promo Offer`,
      description: description || "",
      discountType: resolvedDiscountType,
      value: resolvedValue,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      minAmount: resolvedMinAmount,
      validTill: new Date(resolvedExpiry),
      startDate: startDate ? new Date(startDate) : new Date(),
      applicableBookingTypes: resolvedBookingTypes,
      categoryId: categoryId || "general",
      categoryTitle: categoryTitle || applicableCategory || "General",
      usageLimit: resolvedLimit,
      createdBy: req.user?._id || null,
      status: "active",
    });

    await coupon.save();

    return res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      coupon: {
        ...coupon.toObject(),
        id: coupon._id,
        allocatedCount: 0,
        usedCount: 0,
      },
    });
  } catch (error) {
    console.error("createAdminCoupon error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create coupon",
      error: error.message,
    });
  }
};

export const updateAdminCoupon = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const updates = req.body;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    if (updates.code) coupon.code = String(updates.code).toUpperCase().trim();
    if (updates.title) coupon.title = updates.title.trim();
    if (updates.description !== undefined) coupon.description = updates.description.trim();
    if (updates.discountType) {
      const dt = String(updates.discountType).toUpperCase();
      coupon.discountType = dt === "PERCENT" || dt === "PERCENTAGE" ? "PERCENT" : "FLAT";
    }
    if (updates.value !== undefined) coupon.value = Number(updates.value);
    if (updates.maxDiscount !== undefined) {
      coupon.maxDiscount = updates.maxDiscount ? Number(updates.maxDiscount) : null;
    }
    if (updates.minAmount !== undefined) coupon.minAmount = Number(updates.minAmount);
    if (updates.minOrderAmount !== undefined) coupon.minAmount = Number(updates.minOrderAmount);
    if (updates.validTill || updates.expiryDate) {
      coupon.validTill = new Date(updates.validTill || updates.expiryDate);
    }
    if (updates.usageLimit !== undefined) coupon.usageLimit = Number(updates.usageLimit);
    if (updates.maxUsageLimit !== undefined) coupon.usageLimit = Number(updates.maxUsageLimit);
    if (updates.status) coupon.status = updates.status;

    await coupon.save();

    return res.status(200).json({
      success: true,
      message: "Coupon updated successfully",
      coupon: {
        ...coupon.toObject(),
        id: coupon._id,
      },
    });
  } catch (error) {
    console.error("updateAdminCoupon error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update coupon",
      error: error.message,
    });
  }
};

export const deleteAdminCoupon = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const coupon = await Coupon.findByIdAndDelete(id);

    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    // Mark any remaining active user allocations as expired
    await UserCoupon.updateMany(
      { couponId: coupon._id, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } }
    );

    return res.status(200).json({
      success: true,
      message: "Coupon deleted successfully",
    });
  } catch (error) {
    console.error("deleteAdminCoupon error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete coupon",
      error: error.message,
    });
  }
};

export const getCouponAllocations = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const filter = isObjectId
      ? { $or: [{ couponId: id }, { couponId: new mongoose.Types.ObjectId(id) }] }
      : { couponId: id };

    const allocations = await UserCoupon.find(filter).lean();

    const userIds = allocations.map((a) => String(a.userId));
    return res.status(200).json({
      success: true,
      allocatedUserIds: userIds,
      allocations,
    });
  } catch (error) {
    console.error("getCouponAllocations error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch coupon allocations",
      error: error.message,
    });
  }
};

export const allocateCouponToUsers = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({
        success: false,
        message: "userIds array is required and must not be empty",
      });
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    const cleanedUserIds = [...new Set(userIds.map((uid) => String(uid).trim()).filter(Boolean))];

    // Find users who already have this coupon
    const isObjectId = mongoose.Types.ObjectId.isValid(coupon._id);
    const couponIdFilter = isObjectId
      ? { $in: [coupon._id, String(coupon._id)] }
      : coupon._id;

    const existing = await UserCoupon.find({
      couponId: couponIdFilter,
      userId: { $in: cleanedUserIds },
    }).select("userId").lean();

    const existingSet = new Set(existing.map((e) => String(e.userId)));
    const newUserIds = cleanedUserIds.filter((uid) => !existingSet.has(uid));

    if (newUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "All selected users already have this coupon allocated",
        allocatedCount: 0,
        skippedCount: cleanedUserIds.length,
      });
    }

    const docs = newUserIds.map((uid) => ({
      userId: uid,
      couponId: String(coupon._id),
      code: coupon.code,
      status: "ACTIVE",
      allocatedAt: new Date(),
      collectedAt: new Date(),
    }));

    await UserCoupon.insertMany(docs, { ordered: false });

    return res.status(200).json({
      success: true,
      message: `Successfully allocated coupon to ${newUserIds.length} user(s)`,
      allocatedCount: newUserIds.length,
      skippedCount: existingSet.size,
    });
  } catch (error) {
    console.error("allocateCouponToUsers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to allocate coupon",
      error: error.message,
    });
  }
};

export const getUsersForAllocation = async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim();
    const membership = String(req.query.membership || "").trim();
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || "100"), 10) || 100, 1), 200);

    const filter = {};
    if (role) filter.role = role;
    if (membership) filter.membership = membership;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(filter)
      .select("_id name email phone role membership avatar")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      users,
      total: users.length,
    });
  } catch (error) {
    console.error("getUsersForAllocation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};
