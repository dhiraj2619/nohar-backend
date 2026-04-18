const {
  getOffers,
  createOffer,
  updateOffer,
  deleteOffer,
} = require("../controllers/offer.controller");

const offerRouter = require("express").Router();

offerRouter.get("/", getOffers);
offerRouter.post("/add", createOffer);
offerRouter.put("/update/:id", updateOffer);
offerRouter.delete("/delete/:id", deleteOffer);

module.exports = { offerRouter };
