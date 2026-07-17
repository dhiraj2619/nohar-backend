const WalletTransaction = require("../models/walletTransaction.model");
const AdminInfo = require("../models/adminInfo.model");
const User = require("../models/users.model");

const SIGNUP_BONUS_VALID_DAYS = 30;
const ORDER_REWARD_MATURITY_MINUTES = 10;
const DEFAULT_SIGNUP_BONUS_AMOUNT = 50;
const ORDER_REWARD_POINTS_PER_100 = 2;
const REWARD_TRANSACTION_TYPES = [
  "SIGNUP_BONUS",
  "ORDER_REWARD",
  "REDEEM",
  "EXPIRE",
  "ADJUSTMENT",
];

const addDays = (days) => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const addMinutes = (minutes) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};

const getRewardSettings = async () => {
  const settings = await AdminInfo.findOne()
    .select("newCustomerWelcomeBonus")
    .lean();

  return {
    welcomeBonusAmount: Number(settings?.newCustomerWelcomeBonus ?? DEFAULT_SIGNUP_BONUS_AMOUNT),
  };
};

const creditSignupBonus = async (userId) => {
  const user = await User.findById(userId);

  if (!user || user.signupBonusGranted) return null;
  const { welcomeBonusAmount } = await getRewardSettings();
  const bonusAmount = Math.max(0, Number(welcomeBonusAmount || 0));

  if (bonusAmount <= 0) return null;

  const expiresAt = addDays(SIGNUP_BONUS_VALID_DAYS);

  const tx = await WalletTransaction.create({
    user: user._id,
    type: "SIGNUP_BONUS",
    amount: bonusAmount,
    points: 0,
    note: "Welcome Wallet Bonus",
    expiresAt,
    status: "ACTIVE",
  });

  user.walletBalance += bonusAmount;
  user.signupBonusGranted = true;
  await user.save();

  return tx;
};

const calculateOrderRewardPoints = (amount) => {
  const numericAmount = Number(amount || 0);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  return Math.floor(numericAmount / 100) * ORDER_REWARD_POINTS_PER_100;
};

const earnRewardPoints = async ({ userId, amount, orderId }) => {
  const user = await User.findById(userId);

  if (!user) return null;

  const points = calculateOrderRewardPoints(amount);

  if (points <= 0) return null;

  const tx = await WalletTransaction.create({
    user: user._id,
    type: "ORDER_REWARD",
    amount: 0,
    points,
    sourceOrder: orderId || null,
    note: "Reward points for order",
    expiresAt: addMinutes(ORDER_REWARD_MATURITY_MINUTES),
    status: "ACTIVE",
  });

  user.rewardPoints += points;
  await user.save();

  return tx;
};

const redeemPoints = async ({ userId, points }) => {
  const user = await User.findById(userId);

  if (!user) return null;

  const redeemPointsValue = Number(points || 0);

  if (redeemPointsValue <= 0) {
    throw new Error("points must be greater than 0");
  }

  if (Number(user.rewardPoints || 0) < redeemPointsValue) {
    throw new Error("Insufficient reward points");
  }

  user.rewardPoints = Math.max(0, Number(user.rewardPoints || 0) - redeemPointsValue);
  user.walletBalance = Number(user.walletBalance || 0) + redeemPointsValue;

  const tx = await WalletTransaction.create({
    user: user._id,
    type: "REDEEM",
    points: redeemPointsValue,
    amount: redeemPointsValue,
    note: "Redeem Reward Points",
    status: "REDEEMED",
  });
  await user.save();
  return tx;
};

const expireSignupBonuses = async () => {
  const now = new Date();

  const expiredTransactions = await WalletTransaction.find({
    type: "SIGNUP_BONUS",
    status: "ACTIVE",
    expiresAt: { $lte: now },
  });

  for (const tx of expiredTransactions) {
    tx.status = "EXPIRED";
    await tx.save();

    await User.findByIdAndUpdate(tx.user, {
      $inc: { walletBalance: -tx.amount },
    });
  }

  return expiredTransactions.length;
};

const settleMaturedOrderRewards = async () => {
  const now = new Date();

  const maturedTransactions = await WalletTransaction.find({
    type: "ORDER_REWARD",
    status: "ACTIVE",
    expiresAt: { $lte: now },
    points: { $gt: 0 },
  });

  for (const tx of maturedTransactions) {
    const points = Number(tx.points || 0);

    if (points <= 0) {
      continue;
    }

    const user = await User.findById(tx.user);

    if (!user) {
      tx.status = "EXPIRED";
      tx.note = "Order reward could not be settled because user was missing";
      await tx.save();
      continue;
    }

    user.rewardPoints = Math.max(0, Number(user.rewardPoints || 0) - points);
    user.walletBalance = Number(user.walletBalance || 0) + points;
    await user.save();

    tx.status = "SETTLED";
    tx.note = "Order reward moved to wallet";
    await tx.save();
  }

  return maturedTransactions.length;
};


module.exports = {
  creditSignupBonus,
  calculateOrderRewardPoints,
  earnRewardPoints,
  redeemPoints,
  expireSignupBonuses,
  settleMaturedOrderRewards,
};
