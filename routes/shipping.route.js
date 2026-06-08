const {
  addOrUpdateShippingInfo,
  deleteAddress,
  getShippingInfo,
  updateAddress,
} = require("../controllers/shipping.controller");
const { isAuth } = require("../middlewares/auth.middleware");

const shippingRouter = require("express").Router();

shippingRouter.post("/add", isAuth, addOrUpdateShippingInfo);
shippingRouter.get("/me", isAuth, getShippingInfo);
shippingRouter.get("/get-by-user/:id", getShippingInfo);
shippingRouter.put("/update-address", isAuth, updateAddress);
shippingRouter.delete("/address/:addressId", isAuth, deleteAddress);

module.exports = { shippingRouter };
