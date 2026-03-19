import crypto from "crypto";
import User from "../../user/model/User.js";
import { WalletTransaction } from "../model/WalletTransaction.js";
import { razorpay } from "../../../config/razorpay.js";

const MIN_TOPUP = 1;
const MAX_TOPUP = 5000;
const BOOSTER_THRESHOLD = 1000;
const BOOSTER_RATE = 0.05;

function normalizeAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) return null;
  return Number(amount.toFixed(2));
}

function calculateRewardBonus(amount) {
  if (amount < BOOSTER_THRESHOLD) return 0;
  return Number((amount * BOOSTER_RATE).toFixed(2));
}

export const createWalletOrder = async (req, res) => {
  try {
    const amount = normalizeAmount(req.body?.amount);

    if (amount === null) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    if (amount < MIN_TOPUP || amount > MAX_TOPUP) {
      return res.status(400).json({
        message: `Amount should be between ${MIN_TOPUP} and ${MAX_TOPUP}`,
      });
    }

    const user = await User.findById(req.user.id).select("walletBalance");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const walletBalance = Number((user.walletBalance ?? 0).toFixed(2));
    const remainingLimit = Number((MAX_TOPUP - walletBalance).toFixed(2));
    const bonusAmount = calculateRewardBonus(amount);
    const totalCredit = Number((amount + bonusAmount).toFixed(2));

    if (remainingLimit < MIN_TOPUP) {
      return res.status(400).json({ message: "Wallet limit reached (5000.00)" });
    }

    if (amount > remainingLimit || totalCredit > remainingLimit) {
      return res.status(400).json({
        message: `This top-up exceeds wallet limit after reward bonus. Available space: ₹${remainingLimit.toFixed(
          2
        )}`,
      });
    }

    const amountInPaise = Math.round(amount * 100);
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `${req.user.id}_${Date.now()}`,
      notes: {
        type: "wallet_topup",
        userId: req.user.id,
        amount: amount.toFixed(2),
        bonusAmount: bonusAmount.toFixed(2),
      },
    });

    res.json({
      orderId: order.id,
      amount,
      bonusAmount,
      currency: "INR",
    });
  } catch (err) {
    console.error("createWalletOrder error:", err);
    res.status(500).json({ message: "Failed to create wallet order" });
  }
};

export const verifyWalletPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment details" });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    const creditedAmount = Number((payment.amount / 100).toFixed(2));
    const bonusAmount = calculateRewardBonus(creditedAmount);
    const totalCreditedAmount = Number((creditedAmount + bonusAmount).toFixed(2));

    if (creditedAmount < MIN_TOPUP || creditedAmount > MAX_TOPUP) {
      return res.status(400).json({ message: "Amount outside wallet limits" });
    }

    const maxAllowedBalance = Number((MAX_TOPUP - totalCreditedAmount).toFixed(2));

    const user = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        walletBalance: { $lte: maxAllowedBalance },
      },
      { $inc: { walletBalance: totalCreditedAmount } },
      { new: true }
    );

    if (!user) {
      const existingUser = await User.findById(req.user.id).select("_id");
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      return res
        .status(400)
        .json({ message: "Wallet limit exceeded. Max wallet amount is 5000.00" });
    }

    const balanceAfter = Number(user.walletBalance.toFixed(2));
    const balanceBefore = Number((balanceAfter - totalCreditedAmount).toFixed(2));
    const topupBalanceAfter = Number((balanceBefore + creditedAmount).toFixed(2));

    const transactionDocs = [
      {
        user: req.user.id,
        type: "credit",
        source: "topup",
        amount: creditedAmount,
        balanceBefore,
        balanceAfter: topupBalanceAfter,
        status: "success",
        note: `Wallet top-up via Razorpay (${razorpay_payment_id})`,
      },
    ];

    if (bonusAmount > 0) {
      transactionDocs.push({
        user: req.user.id,
        type: "credit",
        source: "reward_bonus",
        amount: bonusAmount,
        balanceBefore: topupBalanceAfter,
        balanceAfter,
        status: "success",
        note: "Reward booster bonus (5%)",
      });
    }

    await WalletTransaction.create(transactionDocs);

    return res.json({
      message: "Wallet credited successfully",
      walletBalance: balanceAfter,
      creditedAmount,
      bonusAmount,
      totalCreditedAmount,
    });
  } catch (err) {
    console.error("verifyWalletPayment error:", err);
    res.status(500).json({ message: "Payment verification failed" });
  }
};

export const getWalletTransactions = async (req, res) => {
  try {
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page =
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.floor(rawPage)
        : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 100)
        : 20;
    const skip = (page - 1) * limit;

    const total = await WalletTransaction.countDocuments({ user: req.user.id });

    const transactions = await WalletTransaction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({
      transactions: transactions.map((txn) => ({
        id: String(txn._id),
        type: txn.type,
        source: txn.source,
        amount: Number(txn.amount.toFixed(2)),
        balanceBefore: Number(txn.balanceBefore.toFixed(2)),
        balanceAfter: Number(txn.balanceAfter.toFixed(2)),
        status: txn.status,
        note: txn.note || "",
        createdAt: txn.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + transactions.length < total,
      },
    });
  } catch (err) {
    console.error("getWalletTransactions error:", err);
    return res.status(500).json({ message: "Failed to fetch wallet transactions" });
  }
};
