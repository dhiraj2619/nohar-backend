const User = require("../models/users.model");
const WalletTransaction = require("../models/walletTransaction.model");
const { redeemPoints } = require("../services/rewards.service");

const getWalletDetails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "_id walletBalance rewardPoints signupBonusGranted",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const recentTransactions = await WalletTransaction.find({
      user: user._id,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json({
      success: true,
      wallet: {
        walletBalance: user.walletBalance || 0,
        rewardPoints: user.rewardPoints || 0,
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
  redeemWalletPoints,
};
