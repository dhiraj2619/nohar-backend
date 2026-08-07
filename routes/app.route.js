const express = require("express");
const { getAppVersion } = require("../controllers/app.controller");

const appRouter = express.Router();

appRouter.get("/version", getAppVersion);

module.exports = { appRouter };
