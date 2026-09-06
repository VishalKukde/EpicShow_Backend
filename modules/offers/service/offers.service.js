import crypto from "crypto";
import mongoose from "mongoose";
import Coupon from "../model/Coupon.js";
import UserCoupon from "../model/UserCoupon.js";
import {
  calculateOfferDiscount,
  getExpiredOfferCouponIds,
  getOfferCategory,
  getOfferCouponDefinition,
  isOfferCouponExpired,
  listOfferCategories,
} from "../data/offers.catalog.js";

const USER_COUPON_STATUS = {
  ACTIVE: "ACTIVE",
  USED: "USED",
  EXPIRED: "EXPIRED",
};

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && typeof value.toString === "function") {
    return value.toString().trim();
  }
  return String(value).trim();
};

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const createOfferError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const applySession = (query, session) => (session ? query.session(session) : query);

const toUpperCode = (value) => String(value || "").trim().toUpperCase();

const generateCandidateCode = (prefix) => {
  const safePrefix = String(prefix || "SAVE")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 8);

  return `${safePrefix}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
};

export const resolveCouponDefinition = async (couponId, code) => {
  const rawId = normalizeId(couponId);
  const rawCode = toUpperCode(code);

  if (!rawId && !rawCode) return null;

  // 1. Try finding in MongoDB Coupon collection
  let dbCoupon = null;
  if (rawId && mongoose.Types.ObjectId.isValid(rawId)) {
    dbCoupon = await Coupon.findById(rawId).lean();
  }
  if (!dbCoupon && rawCode) {
    dbCoupon = await Coupon.findOne({ code: rawCode }).lean();
  }
  if (!dbCoupon && rawId) {
    dbCoupon = await Coupon.findOne({ code: rawId.toUpperCase() }).lean();
  }

  if (dbCoupon) {
    const validTillStr = new Date(dbCoupon.validTill).toISOString();
    return {
      _id: String(dbCoupon._id),
      id: String(dbCoupon._id),
      categoryId: dbCoupon.categoryId || "general",
      categoryTitle: dbCoupon.categoryTitle || "General",
      title: dbCoupon.title,
      description: dbCoupon.description || "",
      discountType: dbCoupon.discountType,
      value: dbCoupon.value,
      maxDiscount: dbCoupon.maxDiscount ?? null,
      minAmount: dbCoupon.minAmount ?? 0,
      validTill: validTillStr,
      startDate: dbCoupon.startDate ? new Date(dbCoupon.startDate).toISOString() : new Date().toISOString(),
      applicableBookingTypes: dbCoupon.applicableBookingTypes || ["movie", "event", "sport", "gaming"],
      codePrefix: dbCoupon.code,
      status: dbCoupon.status || "active",
      discountLabel:
        dbCoupon.discountLabel ||
        (dbCoupon.discountType === "PERCENT"
          ? `${dbCoupon.value}% OFF${dbCoupon.maxDiscount ? ` up to ₹${dbCoupon.maxDiscount}` : ""}`
          : `₹${dbCoupon.value} OFF`),
      conditions: dbCoupon.conditions || [],
      isDbCoupon: true,
      mongoCouponId: dbCoupon._id,
    };
  }

  // 2. Try static catalog
  const catalogDef = getOfferCouponDefinition(rawId);
  return catalogDef;
};

const buildEligibility = ({ couponDefinition, status, amount, bookingType }) => {
  if (status !== USER_COUPON_STATUS.ACTIVE) {
    const isDeactivated = couponDefinition.status && couponDefinition.status !== "active";
    const reason =
      status === USER_COUPON_STATUS.USED
        ? "Already used"
        : isDeactivated
        ? "Coupon is currently inactive"
        : "Expired";

    return {
      isEligible: false,
      estimatedDiscount: 0,
      ineligibilityReason: reason,
    };
  }

  if (bookingType && !couponDefinition.applicableBookingTypes.includes(bookingType)) {
    return {
      isEligible: false,
      estimatedDiscount: 0,
      ineligibilityReason: `Valid only on ${couponDefinition.applicableBookingTypes.join(", ")} bookings`,
    };
  }

  if (typeof amount === "number" && amount < Number(couponDefinition.minAmount || 0)) {
    return {
      isEligible: false,
      estimatedDiscount: 0,
      ineligibilityReason: `Minimum booking amount is ₹${couponDefinition.minAmount}`,
    };
  }

  const estimatedDiscount =
    typeof amount === "number"
      ? calculateOfferDiscount(couponDefinition, amount)
      : 0;

  return {
    isEligible: true,
    estimatedDiscount,
    ineligibilityReason: null,
  };
};

const serializeCollectedCoupon = (userCoupon, couponDefinition, options = {}) => {
  if (!couponDefinition) {
    return null;
  }

  const isDeactivated = couponDefinition.status && couponDefinition.status !== "active";
  const isExpired = isDeactivated || new Date(couponDefinition.validTill).getTime() < Date.now();
  const resolvedStatus =
    userCoupon.status === USER_COUPON_STATUS.ACTIVE && isExpired
      ? USER_COUPON_STATUS.EXPIRED
      : userCoupon.status;

  const amount =
    typeof options.amount === "number" && Number.isFinite(options.amount)
      ? roundCurrency(options.amount)
      : undefined;
  const bookingType = options.bookingType || null;
  const eligibility = buildEligibility({
    couponDefinition,
    status: resolvedStatus,
    amount,
    bookingType,
  });

  return {
    ...couponDefinition,
    id: normalizeId(userCoupon._id),
    _id: normalizeId(userCoupon._id),
    couponId: normalizeId(userCoupon.couponId || couponDefinition._id),
    code: userCoupon.code || couponDefinition.code || couponDefinition.codePrefix,
    status: resolvedStatus,
    allocatedAt: userCoupon.allocatedAt,
    collectedAt: userCoupon.collectedAt,
    usedAt: userCoupon.usedAt,
    usedBookingId: userCoupon.usedBookingId,
    ...eligibility,
  };
};

export const syncExpiredCouponsForUser = async (userId, options = {}) => {
  const normalizedUserId = normalizeId(userId);

  if (!normalizedUserId) {
    return;
  }

  const expiredCatalogIds = getExpiredOfferCouponIds();
  const now = new Date();

  // Find expired DB coupons
  const expiredDbCoupons = await Coupon.find({
    validTill: { $lt: now },
  }).select("_id").lean();
  const expiredDbCouponIds = expiredDbCoupons.map((c) => c._id);

  const allExpiredCouponIds = [
    ...expiredCatalogIds,
    ...expiredDbCouponIds,
  ];

  if (!allExpiredCouponIds.length) {
    return;
  }

  const query = UserCoupon.updateMany(
    {
      userId: normalizedUserId,
      status: USER_COUPON_STATUS.ACTIVE,
      couponId: { $in: allExpiredCouponIds },
    },
    {
      $set: {
        status: USER_COUPON_STATUS.EXPIRED,
      },
    }
  );

  await applySession(query, options.session);
};

const generateUniqueCouponCode = async (couponDefinition) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCandidateCode(couponDefinition.codePrefix);
    const existing = await UserCoupon.exists({ code });

    if (!existing) {
      return code;
    }
  }

  throw createOfferError("Unable to generate coupon code", 500);
};

export const collectCouponForUser = async (userId, couponId) => {
  const normalizedUserId = normalizeId(userId);

  if (!normalizedUserId) {
    throw createOfferError("Missing user id", 400);
  }

  const couponDefinition = await resolveCouponDefinition(couponId);
  if (!couponDefinition) {
    throw createOfferError("Offer coupon not found", 404);
  }

  if (couponDefinition.status && couponDefinition.status !== "active") {
    throw createOfferError("This coupon is currently inactive", 400);
  }

  if (new Date(couponDefinition.validTill).getTime() < Date.now()) {
    throw createOfferError("This coupon is no longer available", 400);
  }

  await syncExpiredCouponsForUser(normalizedUserId);

  const resolvedCouponId = couponDefinition._id || couponDefinition.id;
  const existing = await UserCoupon.findOne({
    userId: normalizedUserId,
    couponId: resolvedCouponId,
  });

  if (existing) {
    return {
      alreadyCollected: true,
      coupon: serializeCollectedCoupon(existing, couponDefinition),
    };
  }

  const code =
    couponDefinition.code ||
    couponDefinition.codePrefix ||
    (await generateUniqueCouponCode(couponDefinition));

  const created = await UserCoupon.create({
    userId: normalizedUserId,
    couponId: resolvedCouponId,
    code,
    status: USER_COUPON_STATUS.ACTIVE,
    collectedAt: new Date(),
  });

  return {
    alreadyCollected: false,
    coupon: serializeCollectedCoupon(created, couponDefinition),
  };
};

export const getCollectedCouponsForUser = async (userId, options = {}) => {
  const normalizedUserId = normalizeId(userId);

  if (!normalizedUserId) {
    throw createOfferError("Missing user id", 400);
  }

  await syncExpiredCouponsForUser(normalizedUserId);

  const query = UserCoupon.find({ userId: normalizedUserId }).sort({
    collectedAt: -1,
  });
  const coupons = await applySession(query, options.session);

  const serializedCoupons = (
    await Promise.all(
      coupons.map(async (userCoupon) => {
        const def = await resolveCouponDefinition(
          userCoupon.couponId || userCoupon._id,
          userCoupon.code
        );
        if (!def) return null;
        return serializeCollectedCoupon(userCoupon, def, {
          amount: options.amount,
          bookingType: options.bookingType,
        });
      })
    )
  ).filter(Boolean);

  const grouped = {
    ACTIVE: serializedCoupons.filter((coupon) => coupon.status === USER_COUPON_STATUS.ACTIVE),
    USED: serializedCoupons.filter((coupon) => coupon.status === USER_COUPON_STATUS.USED),
    EXPIRED: serializedCoupons.filter((coupon) => coupon.status === USER_COUPON_STATUS.EXPIRED),
  };

  return {
    coupons: serializedCoupons,
    grouped,
    counts: {
      total: serializedCoupons.length,
      active: grouped.ACTIVE.length,
      used: grouped.USED.length,
      expired: grouped.EXPIRED.length,
    },
  };
};

export const getEligibleCouponsForUser = async (userId, options = {}) => {
  const amount = roundCurrency(options.amount);
  const bookingType = String(options.bookingType || "").trim().toLowerCase();

  const { grouped } = await getCollectedCouponsForUser(userId, {
    amount,
    bookingType,
  });

  return grouped.ACTIVE
    .filter((coupon) => coupon.isEligible)
    .sort((left, right) => {
      if (right.estimatedDiscount !== left.estimatedDiscount) {
        return right.estimatedDiscount - left.estimatedDiscount;
      }

      return new Date(left.validTill).getTime() - new Date(right.validTill).getTime();
    });
};

const findRequestedUserCoupon = async ({ userId, couponInput, session }) => {
  const normalizedUserId = normalizeId(userId);
  const requestedId = normalizeId(
    couponInput?.userCouponId || couponInput?.id || couponInput?._id
  );
  const requestedCode = toUpperCode(couponInput?.code);
  const requestedCouponId = normalizeId(couponInput?.couponId);

  if (!requestedId && !requestedCode && !requestedCouponId) {
    throw createOfferError("Invalid coupon selection", 400);
  }

  const orFilters = [];
  if (requestedId) {
    if (mongoose.Types.ObjectId.isValid(requestedId)) {
      orFilters.push({ _id: requestedId });
    }
    orFilters.push({ couponId: requestedId });
  }

  if (requestedCode) {
    orFilters.push({ code: requestedCode });
  }

  if (requestedCouponId) {
    if (mongoose.Types.ObjectId.isValid(requestedCouponId)) {
      orFilters.push({ couponId: requestedCouponId });
    } else {
      orFilters.push({ couponId: requestedCouponId });
    }
  }

  const query = UserCoupon.findOne({
    userId: normalizedUserId,
    $or: orFilters,
  });
  return applySession(query, session);
};

export const resolveCouponApplication = async ({
  userId,
  couponInput,
  amount,
  bookingType,
  session,
}) => {
  if (!couponInput) {
    return null;
  }

  const normalizedUserId = normalizeId(userId);

  if (!normalizedUserId) {
    throw createOfferError("Missing user id", 400);
  }

  await syncExpiredCouponsForUser(normalizedUserId, { session });

  const userCoupon = await findRequestedUserCoupon({
    userId: normalizedUserId,
    couponInput,
    session,
  });

  if (!userCoupon) {
    throw createOfferError("Collect this coupon before applying it", 404);
  }

  const couponDefinition = await resolveCouponDefinition(
    userCoupon.couponId || userCoupon._id,
    userCoupon.code
  );

  if (!couponDefinition) {
    throw createOfferError("This coupon is no longer available", 404);
  }

  const isDeactivated = couponDefinition.status && couponDefinition.status !== "active";
  if (isDeactivated) {
    throw createOfferError("This coupon is currently inactive", 400);
  }

  const isExpired = new Date(couponDefinition.validTill).getTime() < Date.now();
  if (userCoupon.status === USER_COUPON_STATUS.ACTIVE && isExpired) {
    userCoupon.status = USER_COUPON_STATUS.EXPIRED;
    await userCoupon.save({ session });
    throw createOfferError("Coupon has expired", 400);
  }

  if (userCoupon.status === USER_COUPON_STATUS.USED) {
    throw createOfferError("Coupon has already been used", 409);
  }

  if (userCoupon.status === USER_COUPON_STATUS.EXPIRED) {
    throw createOfferError("Coupon has expired", 400);
  }

  const normalizedBookingType = String(bookingType || "").trim().toLowerCase();

  if (
    normalizedBookingType &&
    !couponDefinition.applicableBookingTypes.includes(normalizedBookingType)
  ) {
    throw createOfferError(
      `Coupon is not valid for ${normalizedBookingType} bookings`,
      400
    );
  }

  const bookingAmount = roundCurrency(amount);

  if (bookingAmount < Number(couponDefinition.minAmount || 0)) {
    throw createOfferError(
      `Minimum booking amount is ₹${couponDefinition.minAmount}`,
      400
    );
  }

  const discountAmount = calculateOfferDiscount(couponDefinition, bookingAmount);

  if (discountAmount <= 0) {
    throw createOfferError("Coupon is not eligible for this booking", 400);
  }

  return {
    couponId: couponDefinition.id || couponDefinition._id,
    userCouponId: normalizeId(userCoupon._id),
    code: userCoupon.code,
    discountAmount,
    couponDefinition,
  };
};

export const markCollectedCouponUsed = async ({
  userId,
  couponId,
  bookingId,
  session,
}) => {
  if (!couponId) {
    return null;
  }

  const normalizedUserId = normalizeId(userId);
  const normalizedCouponId = normalizeId(couponId);
  const normalizedBookingId = normalizeId(bookingId);

  const orFilters = [];
  if (mongoose.Types.ObjectId.isValid(normalizedCouponId)) {
    orFilters.push({ _id: normalizedCouponId });
  }
  orFilters.push({ couponId: normalizedCouponId });
  orFilters.push({ code: normalizedCouponId.toUpperCase() });

  const userCoupon = await applySession(
    UserCoupon.findOne({
      userId: normalizedUserId,
      $or: orFilters,
    }),
    session
  );

  if (!userCoupon) {
    throw createOfferError("Collected coupon not found", 404);
  }

  const couponDefinition = await resolveCouponDefinition(
    userCoupon.couponId || userCoupon._id,
    userCoupon.code
  );

  const isExpired =
    !couponDefinition || new Date(couponDefinition.validTill).getTime() < Date.now();

  if (!couponDefinition || isExpired) {
    userCoupon.status = USER_COUPON_STATUS.EXPIRED;
    await userCoupon.save({ session });
    throw createOfferError("Coupon has expired", 400);
  }

  if (userCoupon.status === USER_COUPON_STATUS.USED) {
    throw createOfferError("Coupon has already been used", 409);
  }

  if (userCoupon.status === USER_COUPON_STATUS.EXPIRED) {
    throw createOfferError("Coupon has expired", 400);
  }

  userCoupon.status = USER_COUPON_STATUS.USED;
  userCoupon.usedAt = new Date();
  userCoupon.usedBookingId = normalizedBookingId || null;
  await userCoupon.save({ session });

  // Increment usedCount on DB Coupon if applicable
  if (couponDefinition.isDbCoupon && couponDefinition.mongoCouponId) {
    await Coupon.findByIdAndUpdate(
      couponDefinition.mongoCouponId,
      { $inc: { usedCount: 1 } },
      { session }
    );
  }

  return userCoupon;
};

export const getPublicOfferCategories = () => ({
  categories: listOfferCategories(),
});

export const getPublicOfferCategory = (categoryId) => {
  const category = getOfferCategory(categoryId);

  if (!category) {
    throw createOfferError("Offer category not found", 404);
  }

  return category;
};
