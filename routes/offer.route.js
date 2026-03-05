const {
  getOffers,
  createOffer,
  updateOffer,
} = require("../controllers/offer.controller");

const offerRouter = require("express").Router();

offerRouter.get("/", getOffers);
offerRouter.post("/add", createOffer);
offerRouter.put("/update/:id", updateOffer);

module.exports = { offerRouter };
