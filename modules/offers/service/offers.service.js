import crypto from "crypto";
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

const ensureCouponIsActiveDefinition = (couponDefinition) => {
  if (!couponDefinition) {
    throw createOfferError("Offer coupon not found", 404);
  }

  if (isOfferCouponExpired(couponDefinition)) {
    throw createOfferError("This coupon is no longer available", 400);
  }
};

const buildEligibility = ({ couponDefinition, status, amount, bookingType }) => {
  if (status !== USER_COUPON_STATUS.ACTIVE) {
    const reason =
      status === USER_COUPON_STATUS.USED ? "Already used" : "Expired";

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

const serializeCollectedCoupon = (userCoupon, options = {}) => {
  const couponDefinition = getOfferCouponDefinition(userCoupon._id);

  if (!couponDefinition) {
    return null;
  }

  const resolvedStatus =
    userCoupon.status === USER_COUPON_STATUS.ACTIVE &&
    isOfferCouponExpired(couponDefinition)
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
    id: normalizeId(userCoupon._id),
    _id: userCoupon._id,
    code: userCoupon.code,
    status: resolvedStatus,
    collectedAt: userCoupon.collectedAt,
    usedAt: userCoupon.usedAt,
    usedBookingId: userCoupon.usedBookingId,
    ...couponDefinition,
    ...eligibility,
  };
};

export const syncExpiredCouponsForUser = async (userId, options = {}) => {
  const normalizedUserId = normalizeId(userId);

  if (!normalizedUserId) {
    return;
  }

  const expiredCouponIds = getExpiredOfferCouponIds();

  if (!expiredCouponIds.length) {
    return;
  }

  const query = UserCoupon.updateMany(
    {
      userId: normalizedUserId,
      status: USER_COUPON_STATUS.ACTIVE,
      couponId: { $in: expiredCouponIds },
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
  const couponDefinition = getOfferCouponDefinition(couponId);

  if (!normalizedUserId) {
    throw createOfferError("Missing user id", 400);
  }

  ensureCouponIsActiveDefinition(couponDefinition);
  await syncExpiredCouponsForUser(normalizedUserId);

  const existing = await UserCoupon.findOne({
    userId: normalizedUserId,
    _id: couponDefinition._id,
  });
  
  if (existing) {
    return {
      alreadyCollected: true,
      coupon: serializeCollectedCoupon(existing),
    };
  }

  const code = await generateUniqueCouponCode(couponDefinition);
  const created = await UserCoupon.create({
    userId: normalizedUserId,
    _id: couponDefinition._id,
    code,
    status: USER_COUPON_STATUS.ACTIVE,
    collectedAt: new Date(),
  });

  return {
    alreadyCollected: false,
    coupon: serializeCollectedCoupon(created),
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

  const serializedCoupons = coupons
    .map((coupon) =>
      serializeCollectedCoupon(coupon, {
        amount: options.amount,
        bookingType: options.bookingType,
      })
    )
    .filter(Boolean);

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

  const filters = [{ userId: normalizedUserId }];

  if (requestedId) {
    filters.push({ _id: requestedId });
  }

  if (requestedCode) {
    filters.push({ code: requestedCode });
  }

  if (requestedCouponId) {
    filters.push({ couponId: requestedCouponId });
  }

  const query = UserCoupon.findOne({ $and: filters });
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

  const couponDefinition = getOfferCouponDefinition(userCoupon._id);

  if (!couponDefinition) {
    throw createOfferError("This coupon is no longer available", 404);
  }

  if (
    userCoupon.status === USER_COUPON_STATUS.ACTIVE &&
    isOfferCouponExpired(couponDefinition)
  ) {
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
    couponId: couponDefinition.id,
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

  const userCoupon = await applySession(
    UserCoupon.findOne({
      _id: normalizedCouponId,
      userId: normalizedUserId,
    }),
    session
  );

  if (!userCoupon) {
    throw createOfferError("Collected coupon not found", 404);
  }

  const couponDefinition = getOfferCouponDefinition(userCoupon._id);

  if (!couponDefinition || isOfferCouponExpired(couponDefinition)) {
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
