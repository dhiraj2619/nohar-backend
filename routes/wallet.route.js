const express = require("express");
const { isAuth } = require("../middlewares/auth.middleware");
const {
  getWalletDetails,
  redeemWalletPoints,
} = require("../controllers/wallet.controller");

const walletRouter = express.Router();

walletRouter.get("/", isAuth, getWalletDetails);
walletRouter.post("/redeem", isAuth, redeemWalletPoints);

module.exports = { walletRouter };
