const WalletTransaction = require("../models/walletTransaction.model");
const User = require("../models/users.model");

const SIGNUP_BONUS_AMOUNT = 50;
const SIGNUP_BONUS_VALID_DAYS = 30;
const POINTS_PER_100_SPENT = 2;

const addDays = (days) => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

const creditSignupBonus = async (userId) => {
  const user = await User.findById(userId);

  if (!user || user.signupBonusGranted) return null;

  const expiresAt = addDays(SIGNUP_BONUS_VALID_DAYS);

  const tx = await WalletTransaction.create({
    user: user._id,
    type: "SIGNUP_BONUS",
    amount: SIGNUP_BONUS_AMOUNT,
    points: 0,
    note: "Welcome Wallet Bonus",
    expiresAt,
    status: "ACTIVE",
  });

  user.walletBalance += SIGNUP_BONUS_AMOUNT;
  user.signupBonusGranted = true;
  await user.save();

  return tx;
};

const earnRewardPoints = async ({ userId, amount, orderId }) => {
  const user = await User.findById(userId);

  if (!user) return null;

  const numericAmount = Number(amount || 0);
  const points = Math.floor(numericAmount / 100) * POINTS_PER_100_SPENT;

  if (points <= 0) return null;

  const tx = await WalletTransaction.create({
    user: user._id,
    type: "ORDER_REWARD",
    amount: 0,
    points,
    sourceOrder: orderId || null,
    note: "Reward points for order",
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

  if (user.rewardPoints < redeemPointsValue) {
    throw new Error("Insufficient reward points");
  }

  user.rewardPoints -= redeemPointsValue;
  user.walletBalance -= redeemPointsValue;

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


module.exports = {
  creditSignupBonus,
  earnRewardPoints,
  redeemPoints,
  expireSignupBonuses,
};
