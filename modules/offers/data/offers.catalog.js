const OFFER_CATEGORIES = [
  {
    id: "festival",
    title: "Festival Offers",
    eyebrow: "Seasonal Savings",
    description:
      "Celebrate festive drops with limited-time movie, event, sport, and gaming savings.",
    accentFrom: "#f97316",
    accentTo: "#facc15",
  },
  {
    id: "weekend",
    title: "Weekend Deals",
    eyebrow: "Friday To Sunday",
    description:
      "Weekend-ready discounts for last-minute plans, late-night shows, and group catchups.",
    accentFrom: "#0891b2",
    accentTo: "#22c55e",
  },
  {
    id: "event-based",
    title: "Event-based Offers",
    eyebrow: "By Interest",
    description:
      "Unlock more value on blockbuster movies, live events, sports clashes, and gaming sessions.",
    accentFrom: "#2563eb",
    accentTo: "#8b5cf6",
  },
  {
    id: "special-day",
    title: "Special Day Offers",
    eyebrow: "Date Specials",
    description:
      "One-off deals crafted around memorable days, themed campaigns, and celebratory plans.",
    accentFrom: "#ec4899",
    accentTo: "#fb7185",
  },
];

const OFFER_COUPONS = [
  {
    _id: "diwaliSpecial2026",
    categoryId: "festival",
    title: "Diwali Special",
    description: "Light up the festive rush with a capped percentage discount.",
    discountType: "PERCENT",
    value: 20,
    maxDiscount: 200,
    minAmount: 100,
    validTill: "2026-11-10T23:59:59.000Z",
    applicableBookingTypes: ["movie", "event", "sport", "gaming"],
    codePrefix: "FEST20",
  },
  {
    _id: "newYearBlast2026",
    categoryId: "festival",
    title: "New Year Blast",
    description: "End the year with a flat celebration discount on bigger carts.",
    discountType: "FLAT",
    value: 250,
    maxDiscount: null,
    minAmount: 100,
    validTill: "2026-12-31T23:59:59.000Z",
    applicableBookingTypes: ["movie", "event", "sport"],
    codePrefix: "NY250",
  },
  {
    _id: "weekendBinge2026",
    categoryId: "weekend",
    title: "Weekend Binge",
    description: "A movie-first weekend coupon for prime-time tickets.",
    discountType: "PERCENT",
    value: 15,
    maxDiscount: 180,
    minAmount: 100,
    validTill: "2026-12-27T23:59:59.000Z",
    applicableBookingTypes: ["movie"],
    codePrefix: "WKND15",
  },
  {
    _id: "stadiumSaturday2026",
    categoryId: "weekend",
    title: "Stadium Saturday",
    description: "Weekend sports bookings get a flat match-day savings boost.",
    discountType: "FLAT",
    value: 180,
    maxDiscount: null,
    minAmount: 100,
    validTill: "2026-09-30T23:59:59.000Z",
    applicableBookingTypes: ["sport"],
    codePrefix: "PLAY180",
  },
  {
    _id: "blockbusterBonus2026",
    categoryId: "event-based",
    title: "Blockbuster Bonus",
    description: "Big screen weekends get a premium capped percentage off.",
    discountType: "PERCENT",
    value: 18,
    maxDiscount: 220,
    minAmount: 100,
    validTill: "2026-08-31T23:59:59.000Z",
    applicableBookingTypes: ["movie", "event"],
    codePrefix: "SHOW18",
  },
  {
    _id: "gamingArenaDrop2026",
    categoryId: "event-based",
    title: "Gaming Arena Drop",
    description: "Boost your next gaming session with a flat arena deal.",
    discountType: "FLAT",
    value: 150,
    maxDiscount: null,
    minAmount: 400,
    validTill: "2026-10-15T23:59:59.000Z",
    applicableBookingTypes: ["gaming"],
    codePrefix: "GAME150",
  },
  {
    _id: "mothers-day-moments-2026",
    categoryId: "special-day",
    title: "Mother's Day Moments",
    description: "Plan a thoughtful outing with a family-friendly savings card.",
    discountType: "PERCENT",
    value: 12,
    maxDiscount: 160,
    minAmount: 500,
    validTill: "2026-05-12T23:59:59.000Z",
    applicableBookingTypes: ["movie", "event"],
    codePrefix: "MOM12",
  },
  {
    _id: "friendship-day-2026",
    categoryId: "special-day",
    title: "Friendship Day Pass",
    description: "Group plans deserve a flat discount on shared bookings.",
    discountType: "FLAT",
    value: 200,
    maxDiscount: null,
    minAmount: 800,
    validTill: "2026-08-02T23:59:59.000Z",
    applicableBookingTypes: ["movie", "sport", "gaming"],
    codePrefix: "BFF200",
  },
];

const CATEGORY_MAP = new Map(OFFER_CATEGORIES.map((category) => [category.id, category]));
const COUPON_MAP = new Map(OFFER_COUPONS.map((coupon) => [coupon._id, coupon]));

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const formatDiscountLabel = (coupon) => {
  if (coupon.discountType === "PERCENT") {
    const cap = coupon.maxDiscount ? ` up to ₹${coupon.maxDiscount}` : "";
    return `${coupon.value}% OFF${cap}`;
  }

  return `₹${coupon.value} OFF`;
};

const formatBookingTypeLabel = (value) => {
  switch (value) {
    case "movie":
      return "Movies";
    case "event":
      return "Events";
    case "sport":
      return "Sports";
    case "gaming":
      return "Gaming";
    default:
      return value;
  }
};

const buildCouponConditions = (coupon) => {
  const labels = coupon.applicableBookingTypes.map(formatBookingTypeLabel).join(", ");

  return [
    `Minimum booking ₹${coupon.minAmount}`,
    `Valid on ${labels}`,
    `Use before ${coupon.validTill.slice(0, 10)}`,
  ];
};

export const isOfferCouponExpired = (coupon, now = new Date()) =>
  new Date(coupon.validTill).getTime() < now.getTime();

export const calculateOfferDiscount = (coupon, amount) => {
  const bookingAmount = roundCurrency(amount);

  if (!Number.isFinite(bookingAmount) || bookingAmount <= 0) {
    return 0;
  }

  if (bookingAmount < Number(coupon.minAmount || 0)) {
    return 0;
  }

  let discount =
    coupon.discountType === "PERCENT"
      ? (bookingAmount * Number(coupon.value || 0)) / 100
      : Number(coupon.value || 0);

  if (coupon.maxDiscount) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }

  return Math.min(roundCurrency(discount), bookingAmount);
};

export const serializeOfferCoupon = (coupon) => {
  const category = CATEGORY_MAP.get(coupon.categoryId);

  return {
    ...coupon,
    categoryTitle: category?.title || coupon.categoryId,
    discountLabel: formatDiscountLabel(coupon),
    conditions: buildCouponConditions(coupon),
  };
};

export const listOfferCategories = (options = {}) => {
  const now = options.now || new Date();

  return OFFER_CATEGORIES.map((category) => {
    const coupons = OFFER_COUPONS.filter(
      (coupon) => coupon.categoryId === category.id && !isOfferCouponExpired(coupon, now)
    ).map(serializeOfferCoupon);

    return {
      ...category,
      couponCount: coupons.length,
      featuredCoupons: coupons.slice(0, 2),
    };
  });
};

export const getOfferCategory = (categoryId, options = {}) => {
  const normalizedCategoryId = String(categoryId || "").trim().toLowerCase();
  const category = CATEGORY_MAP.get(normalizedCategoryId);

  if (!category) {
    return null;
  }

  const now = options.now || new Date();
  const coupons = OFFER_COUPONS.filter(
    (coupon) => coupon.categoryId === normalizedCategoryId && !isOfferCouponExpired(coupon, now)
  ).map(serializeOfferCoupon);

  return {
    ...category,
    couponCount: coupons.length,
    coupons,
  };
};

export const getOfferCouponDefinition = (couponId) => {
  const coupon = COUPON_MAP.get(String(couponId || "").trim());
  return coupon ? serializeOfferCoupon(coupon) : null;
};

export const getExpiredOfferCouponIds = (now = new Date()) =>
  OFFER_COUPONS.filter((coupon) => isOfferCouponExpired(coupon, now)).map((coupon) => coupon.id);

export const listOfferCoupons = () => OFFER_COUPONS.map(serializeOfferCoupon);
