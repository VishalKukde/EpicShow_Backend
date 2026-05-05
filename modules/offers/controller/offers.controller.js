import {
  collectCouponForUser,
  getCollectedCouponsForUser,
  getEligibleCouponsForUser,
  getPublicOfferCategories,
  getPublicOfferCategory,
} from "../service/offers.service.js";

const parseAmount = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getOffers = async (req, res) => {
  try {
    res.json(getPublicOfferCategories());
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Failed to load offers",
    });
  }
};

export const getOfferCategoryCoupons = async (req, res) => {
  try {
    res.json(getPublicOfferCategory(req.params.category));
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Failed to load offer category",
    });
  }
};

export const collectCoupon = async (req, res) => {
  try {
    const result = await collectCouponForUser(req.user?.id, req.params.couponId);

    res.status(result.alreadyCollected ? 200 : 201).json({
      message: result.alreadyCollected
        ? "Coupon already collected"
        : "Coupon collected successfully",
      ...result,
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Unable to collect coupon",
    });
  }
};

export const getMyCoupons = async (req, res) => {
  try {
    const amount = parseAmount(req.query.amount);
    const bookingType = String(req.query.bookingType || "").trim().toLowerCase() || undefined;
    const status = String(req.query.status || "").trim().toUpperCase() || undefined;

    const response = await getCollectedCouponsForUser(req.user?.id, {
      amount,
      bookingType,
    });

    if (!status) {
      return res.json(response);
    }

    const filteredCoupons = response.coupons.filter((coupon) => coupon.status === status);

    return res.json({
      coupons: filteredCoupons,
      grouped: {
        ACTIVE: status === "ACTIVE" ? filteredCoupons : [],
        USED: status === "USED" ? filteredCoupons : [],
        EXPIRED: status === "EXPIRED" ? filteredCoupons : [],
      },
      counts: response.counts,
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Failed to load coupons",
    });
  }
};

export const getEligibleCoupons = async (req, res) => {
  try {
    const amount = parseAmount(req.query.amount);
    const bookingType = String(req.query.bookingType || "").trim().toLowerCase();

    if (!bookingType || amount === undefined) {
      return res.status(400).json({
        message: "bookingType and amount are required",
      });
    }

    const coupons = await getEligibleCouponsForUser(req.user?.id, {
      amount,
      bookingType,
    });

    return res.json({
      coupons,
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : "Failed to load eligible coupons",
    });
  }
};
