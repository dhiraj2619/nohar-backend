const { getPincodeLocation } = require("../controllers/location.controller");

const locationRouter = require("express").Router();

locationRouter.get("/pincode/:pincode", getPincodeLocation);

module.exports = { locationRouter };
