const {
  getOwnerAdmin,
  loginAdmin,
} = require("../controllers/admin.controller");

const adminRouter = require("express").Router();

adminRouter.post("/login", loginAdmin);
adminRouter.get("/owner", getOwnerAdmin);

module.exports = { adminRouter };
