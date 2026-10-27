const express = require("express");
const { trackReferralVisit } = require("../controllers/referral.controller");

const referralRouter = express.Router();

referralRouter.post("/visit", trackReferralVisit);

module.exports = { referralRouter };
