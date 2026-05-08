import mongoose from "mongoose";
import Subscription from "../model/Subscription.js";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../../wallet/model/WalletTransaction.js";

const PRO_PLAN_PRICE = Number(process.env.PRO_PLAN_PRICE || 299);
const PRO_PLAN_PRICES = {
  monthly: PRO_PLAN_PRICE,
  quarterly: Number(process.env.PRO_PLAN_QUARTERLY_PRICE || 799),
  yearly: Number(process.env.PRO_PLAN_YEARLY_PRICE || 2799),
};
const PRO_PLAN_DURATIONS = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};
const DEFAULT_DURATION_DAYS = Number(process.env.SUBSCRIPTION_DURATION_DAYS || 30);
const ENTITLED_STATUSES = ["active", "cancelled"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeObjectId(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error("Invalid user id");
    error.statusCode = 400;
    throw error;
  }

  return new mongoose.Types.ObjectId(userId);
}

function isDuplicateActiveSubscriptionError(error) {
  return error?.code === 11000;
}

export function getProPlanPrice() {
  return PRO_PLAN_PRICE;
}

export function getPlanBillingDetails(cycle = "monthly") {
  const normalizedCycle = ["monthly", "quarterly", "yearly"].includes(cycle)
    ? cycle
    : "monthly";

  return {
    cycle: normalizedCycle,
    amount: PRO_PLAN_PRICES[normalizedCycle],
    durationDays:
      normalizedCycle === "monthly"
        ? DEFAULT_DURATION_DAYS
        : PRO_PLAN_DURATIONS[normalizedCycle],
  };
}

export async function syncMembership(userId, options = {}) {
  const normalizedUserId = normalizeObjectId(userId);
  const now = options.now || new Date();
  const session = options.session;

  const entitledSubscription = await Subscription.exists({
    userId: normalizedUserId,
    status: { $in: ENTITLED_STATUSES },
    endDate: { $gt: now },
  }).session(session || null);

  const membership = entitledSubscription ? "pro" : "free";

  await User.updateOne(
    { _id: normalizedUserId },
    { $set: { membership } },
    { session }
  );

  return membership;
}

export async function createSubscription(userId, plan = "pro", options = {}) {
  const normalizedUserId = normalizeObjectId(userId);

  if (plan !== "pro") {
    const error = new Error("Only the pro plan can be purchased");
    error.statusCode = 400;
    throw error;
  }

  const session = options.session;
  const now = options.startDate || new Date();
  const durationDays = Number(options.durationDays || DEFAULT_DURATION_DAYS);
  const endDate = options.endDate || addDays(now, durationDays);

  const existingActive = await Subscription.findOne({
    userId: normalizedUserId,
    status: "active",
    endDate: { $gt: now },
  }).session(session || null);

  if (existingActive) {
    const error = new Error("User already has an active subscription");
    error.statusCode = 409;
    throw error;
  }

  try {
    const [subscription] = await Subscription.create(
      [
        {
          userId: normalizedUserId,
          plan,
          status: "active",
          startDate: now,
          endDate,
          paymentProvider: options.paymentProvider || "razorpay",
          externalSubscriptionId: options.externalSubscriptionId,
          metadata: options.metadata,
        },
      ],
      { session }
    );

    await syncMembership(normalizedUserId, { session, now });
    return subscription;
  } catch (error) {
    if (isDuplicateActiveSubscriptionError(error)) {
      const conflict = new Error("User already has an active subscription");
      conflict.statusCode = 409;
      throw conflict;
    }

    throw error;
  }
}

export async function cancelSubscription(userId, options = {}) {
  const normalizedUserId = normalizeObjectId(userId);
  const now = options.now || new Date();
  const session = options.session;

  const subscription = await Subscription.findOneAndUpdate(
    {
      userId: normalizedUserId,
      status: "active",
      endDate: { $gt: now },
    },
    {
      $set: {
        status: "cancelled",
        metadata: {
          ...(options.metadata || {}),
          cancelledAt: now,
          cancelReason: options.reason || "user_requested",
        },
      },
    },
    { new: true, session }
  );

  if (!subscription) {
    const error = new Error("No active subscription found");
    error.statusCode = 404;
    throw error;
  }

  await syncMembership(normalizedUserId, { session, now });
  return subscription;
}

export async function markSubscriptionPastDueByExternalId(
  externalSubscriptionId,
  metadata = {}
) {
  const subscription = await Subscription.findOneAndUpdate(
    { externalSubscriptionId, status: "active" },
    {
      $set: {
        status: "past_due",
        metadata: {
          ...metadata,
          pastDueAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (subscription) {
    await syncMembership(subscription.userId);
  }

  return subscription;
}

export async function expireSubscriptions(options = {}) {
  const now = options.now || new Date();
  const limit = Number(options.limit || 5000);

  const expiredSubscriptions = await Subscription.find({
    status: { $in: ENTITLED_STATUSES },
    endDate: { $lt: now },
  })
    .select("_id userId")
    .sort({ endDate: 1 })
    .limit(limit)
    .lean();

  if (!expiredSubscriptions.length) {
    return { expiredCount: 0, syncedUsers: 0 };
  }

  const subscriptionIds = expiredSubscriptions.map((item) => item._id);
  const userIds = [
    ...new Set(expiredSubscriptions.map((item) => String(item.userId))),
  ];

  await Subscription.updateMany(
    { _id: { $in: subscriptionIds } },
    {
      $set: {
        status: "expired",
        "metadata.expiredAt": now,
      },
    }
  );

  const stillEntitled = await Subscription.distinct("userId", {
    userId: { $in: userIds },
    status: { $in: ENTITLED_STATUSES },
    endDate: { $gt: now },
  });

  const stillEntitledSet = new Set(stillEntitled.map(String));
  const usersToDowngrade = userIds.filter((id) => !stillEntitledSet.has(id));

  if (usersToDowngrade.length) {
    await User.updateMany(
      { _id: { $in: usersToDowngrade } },
      { $set: { membership: "free" } }
    );
  }

  return {
    expiredCount: expiredSubscriptions.length,
    syncedUsers: usersToDowngrade.length,
  };
}

export async function getSubscriptionStatus(userId) {
  const normalizedUserId = normalizeObjectId(userId);
  const now = new Date();

  const subscription = await Subscription.findOne({
    userId: normalizedUserId,
    status: { $in: ["active", "cancelled", "past_due"] },
  })
    .sort({ endDate: -1 })
    .lean();

  const membership = await syncMembership(normalizedUserId, { now });

  return {
    membership,
    subscription,
    isPro: membership === "pro",
    planPrice: PRO_PLAN_PRICE,
  };
}

export async function createSubscriptionWithWallet(userId, plan = "pro", options = {}) {
  const normalizedUserId = normalizeObjectId(userId);
  const session = await mongoose.startSession();
  const amount = Number(options.amount || PRO_PLAN_PRICE);

  try {
    let result;

    await session.withTransaction(async () => {
      const user = await User.findById(normalizedUserId).session(session);

      if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }

      const balanceBefore = Number((user.walletBalance || 0).toFixed(2));

      if (balanceBefore < amount) {
        const error = new Error("Insufficient wallet balance");
        error.statusCode = 400;
        throw error;
      }

      const balanceAfter = Number((balanceBefore - amount).toFixed(2));
      const updatedUser = await User.findOneAndUpdate(
        { _id: normalizedUserId, walletBalance: { $gte: amount } },
        { $inc: { walletBalance: -amount } },
        { new: true, session }
      );

      if (!updatedUser) {
        const error = new Error("Unable to deduct wallet balance");
        error.statusCode = 409;
        throw error;
      }

      const subscription = await createSubscription(normalizedUserId, plan, {
        session,
        durationDays: options.durationDays,
        metadata: {
          paymentMethod: "wallet",
          billingCycle: options.billingCycle || "monthly",
        },
      });

      await WalletTransaction.create(
        [
          {
            user: normalizedUserId,
            type: "debit",
            source: "subscription",
            amount,
            balanceBefore,
            balanceAfter,
            status: "success",
            note: `Pro subscription for ${options.durationDays || DEFAULT_DURATION_DAYS} days`,
          },
        ],
        { session }
      );

      result = {
        subscription,
        walletBalance: Number(updatedUser.walletBalance.toFixed(2)),
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}
