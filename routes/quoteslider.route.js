const express = require("express");
const { getQuoteSliders } = require("../controllers/quoteslider.controller");

const quoteSliderRouter = express.Router();

quoteSliderRouter.get("/", getQuoteSliders);
quoteSliderRouter.get("/get-all", getQuoteSliders);

module.exports = { quoteSliderRouter };
