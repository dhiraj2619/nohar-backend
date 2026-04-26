const express = require("express");
const { getActiveAds } = require("../controllers/ad.controller");

const adRouter = express.Router();

adRouter.get("/", getActiveAds);
adRouter.get("/get-all", getActiveAds);

module.exports = { adRouter };
