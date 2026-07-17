const User = require("../models/users.model");
const WalletTransaction = require("../models/walletTransaction.model");
const {
  calculateRewardPointBalance,
  redeemPoints,
  settleMaturedOrderRewards,
} = require("../services/rewards.service");

const REWARD_TRANSACTION_TYPES = [
  "SIGNUP_BONUS",
  "ORDER_REWARD",
  "REDEEM",
  "EXPIRE",
  "ADJUSTMENT",
];

const getWalletDetails = async (req, res) => {
  try {
    await settleMaturedOrderRewards();

    const user = await User.findById(req.user._id).select(
      "_id walletBalance rewardPoints signupBonusGranted",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const rewardTransactions = await WalletTransaction.find({
      user: user._id,
      type: { $in: REWARD_TRANSACTION_TYPES },
    })
      .select("type points amount")
      .lean();

    const recentTransactions = await WalletTransaction.find({
      user: user._id,
    })
      .populate("sourceOrder", "_id orderNumber totalPrice amountPaid paymentMode")
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({
      success: true,
      wallet: {
        walletBalance: user.walletBalance || 0,
        rewardPoints:
          calculateRewardPointBalance(rewardTransactions) ||
          user.rewardPoints ||
          0,
        signupBonusGranted: Boolean(user.signupBonusGranted),
      },
      transactions: recentTransactions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch wallet details",
    });
  }
};

const refreshWalletRewards = async (req, res) => {
  try {
    await settleMaturedOrderRewards();
    return res.status(200).json({
      success: true,
      message: "Wallet rewards refreshed",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to refresh wallet rewards",
    });
  }
};

const getWalletRewards = async (req, res) => {
  try {
    await settleMaturedOrderRewards();

    const user = await User.findById(req.user._id).select(
      "_id walletBalance rewardPoints signupBonusGranted",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const rewardTransactions = await WalletTransaction.find({
      user: user._id,
      type: { $in: REWARD_TRANSACTION_TYPES },
    })
      .select("type points amount")
      .lean();

    const transactions = await WalletTransaction.find({
      user: user._id,
      type: { $in: REWARD_TRANSACTION_TYPES },
    })
      .populate("sourceOrder", "_id orderNumber totalPrice amountPaid paymentMode")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      success: true,
      wallet: {
        walletBalance: user.walletBalance || 0,
        rewardPoints:
          calculateRewardPointBalance(rewardTransactions) ||
          user.rewardPoints ||
          0,
        signupBonusGranted: Boolean(user.signupBonusGranted),
      },
      transactions: transactions.map((tx) => ({
        ...tx,
        sourceOrder: tx.sourceOrder
          ? {
              ...tx.sourceOrder,
              orderAmount: tx.sourceOrder.totalPrice,
            }
          : null,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch wallet rewards",
    });
  }
};

const redeemWalletPoints = async (req, res) => {
  try {
    const { points } = req.body;
    const userId = req.user._id;

    await redeemPoints({
      userId,
      points: Number(points || 0),
    });

    const user = await User.findById(userId).select(
      "_id walletBalance rewardPoints",
    );

    return res.status(200).json({
      success: true,
      message: "Points redeemed successfully",
      walletBalance: user?.walletBalance || 0,
      rewardPoints: user?.rewardPoints || 0,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Error occurred while redeeming points",
    });
  }
};

module.exports = {
  getWalletDetails,
  getWalletRewards,
  refreshWalletRewards,
  redeemWalletPoints,
};
