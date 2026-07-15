const express = require("express");
const { isAuth } = require("../middlewares/auth.middleware");
const {
  getWalletDetails,
  getWalletRewards,
  refreshWalletRewards,
  redeemWalletPoints,
} = require("../controllers/wallet.controller");

const walletRouter = express.Router();

walletRouter.get("/", isAuth, getWalletDetails);
walletRouter.get("/rewards", isAuth, getWalletRewards);
walletRouter.post("/refresh-rewards", isAuth, refreshWalletRewards);
walletRouter.post("/redeem", isAuth, redeemWalletPoints);

module.exports = { walletRouter };
