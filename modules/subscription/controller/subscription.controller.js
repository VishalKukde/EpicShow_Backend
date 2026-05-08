import crypto from "crypto";
import mongoose from "mongoose";
import asyncHandler from "../../../utils/asyncHandler.js";
import {
  cancelSubscription,
  createSubscription,
  createSubscriptionWithWallet,
  getPlanBillingDetails,
  getSubscriptionStatus,
  markSubscriptionPastDueByExternalId,
  syncMembership,
} from "../service/subscription.service.js";
import Subscription from "../model/Subscription.js";
import SubscriptionCheckout from "../model/SubscriptionCheckout.js";
import Payment from "../../movies/models/Payment.js";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";

function getUserId(req) {
  return req.user?._id || req.user?.id;
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function assertNoActiveSubscription(userId, session = null) {
  const activeSubscription = await Subscription.exists({
    userId,
    status: "active",
    endDate: { $gt: new Date() },
  }).session(session);

  if (activeSubscription) {
    throw createHttpError("User already has an active subscription", 409);
  }
}

function verifyRazorpayWebhook(req) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_SECRET;

  if (!secret) {
    const error = new Error("Razorpay webhook secret is not configured");
    error.statusCode = 500;
    throw error;
  }

  const signature = req.headers["x-razorpay-signature"];
  const body = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body || {}));

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  const signatureBuffer = Buffer.from(String(signature || ""), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    const error = new Error("Invalid Razorpay webhook signature");
    error.statusCode = 400;
    throw error;
  }

  return JSON.parse(body.toString("utf8"));
}

function resolveWebhookSubscriptionEntity(payload) {
  return payload?.payload?.subscription?.entity || payload?.subscription || null;
}

function resolveWebhookPaymentEntity(payload) {
  return payload?.payload?.payment?.entity || payload?.payment || null;
}

function resolveWebhookUserId(payload) {
  const subscription = resolveWebhookSubscriptionEntity(payload);
  const payment = resolveWebhookPaymentEntity(payload);

  return (
    subscription?.notes?.userId ||
    subscription?.notes?.user_id ||
    payment?.notes?.userId ||
    payment?.notes?.user_id ||
    null
  );
}

export const upgradeSubscription = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const plan = req.body?.plan || "pro";
  const paymentMethod = req.body?.paymentMethod || "wallet";
  const billing = getPlanBillingDetails(req.body?.billingCycle);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  let result;

  if (paymentMethod === "wallet") {
    result = await createSubscriptionWithWallet(userId, plan, {
      amount: billing.amount,
      durationDays: billing.durationDays,
      billingCycle: billing.cycle,
    });
  } else if (paymentMethod === "mock" || paymentMethod === "razorpay") {
    const subscription = await createSubscription(userId, plan, {
      durationDays: billing.durationDays,
      externalSubscriptionId: req.body?.externalSubscriptionId,
      metadata: {
        paymentMethod,
        billingCycle: billing.cycle,
        mockPayment: paymentMethod === "mock",
      },
    });

    result = {
      subscription,
      walletBalance: req.user.walletBalance,
    };
  } else {
    return res.status(400).json({ message: "Unsupported payment method" });
  }

  res.status(201).json({
    message: "Subscription upgraded successfully",
    membership: "pro",
    subscription: result.subscription,
    walletBalance: result.walletBalance,
    chargedAmount: billing.amount,
  });
});

export const cancelUserSubscription = asyncHandler(async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const subscription = await cancelSubscription(userId, {
    reason: req.body?.reason,
  });

  res.json({
    message: "Subscription cancelled. Pro access remains until expiry.",
    membership: "pro",
    subscription,
  });
});

export const getCurrentSubscriptionStatus = asyncHandler(async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const status = await getSubscriptionStatus(userId);
  res.json(status);
});

export const prepareSubscriptionCheckout = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const billing = getPlanBillingDetails(req.body?.billingCycle);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await assertNoActiveSubscription(userId);

  res.json({
    plan: "pro",
    billingCycle: billing.cycle,
    amount: billing.amount,
    currency: "INR",
    durationDays: billing.durationDays,
  });
});

export const createSubscriptionCheckoutOrder = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const billing = getPlanBillingDetails(req.body?.billingCycle);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await assertNoActiveSubscription(userId);

  const checkout = await SubscriptionCheckout.create({
    userId,
    plan: "pro",
    billingCycle: billing.cycle,
    amount: billing.amount,
    currency: "INR",
    status: "pending",
    metadata: {
      durationDays: billing.durationDays,
    },
  });

  const order = await razorpay.orders.create({
    amount: Math.round(billing.amount * 100),
    currency: "INR",
    receipt: `sub_${checkout._id}`,
    notes: {
      type: "subscription",
      checkoutId: String(checkout._id),
      userId: String(userId),
      billingCycle: billing.cycle,
    },
  });

  checkout.razorpayOrderId = order.id;
  await checkout.save();

  res.status(201).json({
    checkoutId: checkout._id,
    razorpayOrderId: order.id,
    amount: billing.amount,
    currency: "INR",
    billingCycle: billing.cycle,
  });
});

export const verifySubscriptionCheckoutPayment = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const {
    checkoutId,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body || {};

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!checkoutId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: "Missing payment details" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ message: "Invalid payment signature" });
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const checkout = await SubscriptionCheckout.findOne({
        _id: checkoutId,
        userId,
      }).session(session);

      if (!checkout) {
        throw createHttpError("Subscription checkout not found", 404);
      }

      if (checkout.status === "paid") {
        result = {
          subscriptionId: checkout.subscriptionId,
          alreadyPaid: true,
          paymentId: checkout.paymentId,
        };
        return;
      }

      if (checkout.status !== "pending") {
        throw createHttpError("Subscription checkout is not payable", 400);
      }

      await assertNoActiveSubscription(userId, session);

      const billing = getPlanBillingDetails(checkout.billingCycle);
      const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
      const subscription = await createSubscription(userId, "pro", {
        session,
        durationDays: billing.durationDays,
        metadata: {
          paymentMethod: paymentDetails.method || "razorpay",
          billingCycle: checkout.billingCycle,
          checkoutId: String(checkout._id),
        },
      });

      const payment = await Payment.create(
        [
          {
            paymentFor: "subscription",
            bookingId: null,
            subscriptionId: subscription._id,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            method: paymentDetails.method,
            amount: checkout.amount,
            currency: paymentDetails.currency || checkout.currency,
            status: "success",
          },
        ],
        { session }
      );

      checkout.status = "paid";
      checkout.paymentId = razorpay_payment_id;
      checkout.subscriptionId = subscription._id;
      await checkout.save({ session });

      result = {
        subscriptionId: subscription._id,
        paymentId: payment[0]._id,
      };
    });

    const membership = await syncMembership(userId);

    res.json({
      success: true,
      membership,
      ...result,
    });
  } finally {
    await session.endSession();
  }
});

export const paySubscriptionCheckoutWithWallet = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { checkoutId } = req.body || {};

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!checkoutId) {
    return res.status(400).json({ message: "Missing checkout id" });
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      const checkout = await SubscriptionCheckout.findOne({
        _id: checkoutId,
        userId,
      }).session(session);

      if (!checkout) {
        throw createHttpError("Subscription checkout not found", 404);
      }

      if (checkout.status === "paid") {
        result = {
          subscriptionId: checkout.subscriptionId,
          alreadyPaid: true,
          walletBalance: req.user.walletBalance,
        };
        return;
      }

      if (checkout.status !== "pending") {
        throw createHttpError("Subscription checkout is not payable", 400);
      }

      await assertNoActiveSubscription(userId, session);

      const user = await User.findById(userId).session(session);
      if (!user) {
        throw createHttpError("User not found", 404);
      }

      const amount = Number((checkout.amount || 0).toFixed(2));
      const balanceBefore = Number((user.walletBalance || 0).toFixed(2));

      if (balanceBefore < amount) {
        throw createHttpError("Insufficient wallet balance", 400);
      }

      const balanceAfter = Number((balanceBefore - amount).toFixed(2));
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, walletBalance: { $gte: amount } },
        { $inc: { walletBalance: -amount } },
        { new: true, session }
      );

      if (!updatedUser) {
        throw createHttpError("Unable to deduct wallet balance", 409);
      }

      const billing = getPlanBillingDetails(checkout.billingCycle);
      const subscription = await createSubscription(userId, "pro", {
        session,
        durationDays: billing.durationDays,
        metadata: {
          paymentMethod: "wallet",
          billingCycle: checkout.billingCycle,
          checkoutId: String(checkout._id),
        },
      });
      const paymentId = `sub_wallet_${checkout._id}_${Date.now()}`;

      const payment = await Payment.create(
        [
          {
            paymentFor: "subscription",
            bookingId: null,
            subscriptionId: subscription._id,
            orderId: `wallet_order_${checkout._id}`,
            paymentId,
            signature: "wallet",
            method: "wallet",
            amount,
            currency: checkout.currency,
            status: "success",
          },
        ],
        { session }
      );

      await WalletTransaction.create(
        [
          {
            user: userId,
            type: "debit",
            source: "subscription",
            amount,
            balanceBefore,
            balanceAfter,
            status: "success",
            note: `Pro subscription payment (${subscription._id})`,
            payment: payment[0]._id,
          },
        ],
        { session }
      );

      checkout.status = "paid";
      checkout.paymentId = paymentId;
      checkout.subscriptionId = subscription._id;
      await checkout.save({ session });

      result = {
        subscriptionId: subscription._id,
        paymentId: payment[0]._id,
        walletBalance: Number(updatedUser.walletBalance.toFixed(2)),
      };
    });

    const membership = await syncMembership(userId);

    res.json({
      success: true,
      membership,
      ...result,
    });
  } finally {
    await session.endSession();
  }
});

export const markSubscriptionCheckoutFailed = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { checkoutId } = req.body || {};

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!checkoutId) {
    return res.status(400).json({ message: "Missing checkout id" });
  }

  await SubscriptionCheckout.findOneAndUpdate(
    { _id: checkoutId, userId, status: "pending" },
    { $set: { status: "failed" } }
  );

  res.json({ success: true });
});

export const handleRazorpaySubscriptionWebhook = asyncHandler(async (req, res) => {
  const payload = verifyRazorpayWebhook(req);
  const event = payload?.event;
  const subscriptionEntity = resolveWebhookSubscriptionEntity(payload);
  const userId = resolveWebhookUserId(payload);
  const externalSubscriptionId = subscriptionEntity?.id;

  if (!event) {
    return res.status(400).json({ message: "Webhook event is required" });
  }

  if (["subscription.activated", "subscription.charged"].includes(event)) {
    if (!userId) {
      return res.status(202).json({ message: "Webhook accepted without user mapping" });
    }

    if (externalSubscriptionId) {
      const existingSubscription = await Subscription.findOne({
        externalSubscriptionId,
      });

      if (existingSubscription) {
        await syncMembership(existingSubscription.userId);
        return res.json({
          received: true,
          subscriptionId: existingSubscription._id,
          duplicate: true,
        });
      }
    }

    const subscription = await createSubscription(userId, "pro", {
      externalSubscriptionId,
      metadata: {
        razorpayEvent: event,
        razorpayStatus: subscriptionEntity?.status,
      },
    });

    return res.json({ received: true, subscriptionId: subscription._id });
  }

  if (["subscription.cancelled", "subscription.completed"].includes(event)) {
    let subscription = null;

    if (externalSubscriptionId) {
      subscription = await Subscription.findOneAndUpdate(
        { externalSubscriptionId },
        {
          $set: {
            status: "cancelled",
            "metadata.razorpayEvent": event,
            "metadata.cancelledAt": new Date(),
          },
        },
        { new: true }
      );
    }

    if (!subscription && userId) {
      subscription = await cancelSubscription(userId, {
        reason: `razorpay_${event}`,
        metadata: { razorpayEvent: event },
      });
    }

    if (subscription) {
      await syncMembership(subscription.userId);
    }

    return res.json({ received: true });
  }

  if (event === "subscription.expired") {
    let subscription = null;

    if (externalSubscriptionId) {
      subscription = await Subscription.findOneAndUpdate(
        { externalSubscriptionId },
        {
          $set: {
            status: "expired",
            "metadata.razorpayEvent": event,
            "metadata.expiredAt": new Date(),
          },
        },
        { new: true }
      );
    }

    if (subscription) {
      await syncMembership(subscription.userId);
    }

    return res.json({ received: true });
  }

  if (["subscription.pending", "subscription.halted"].includes(event)) {
    if (externalSubscriptionId) {
      await markSubscriptionPastDueByExternalId(externalSubscriptionId, {
        razorpayEvent: event,
      });
    }

    return res.json({ received: true });
  }

  return res.json({ received: true, ignored: true });
});
