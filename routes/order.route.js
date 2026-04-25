const express = require("express");
const {
  createOrder,
  cancelOrder,
  getOrders,
  getUserOrders,
  downloadOrderInvoice,
  updateOrderStatus,
} = require("../controllers/order.controller");
const { isAuth } = require("../middlewares/auth.middleware");

const orderRouter = express.Router();

orderRouter.post("/create", createOrder);
orderRouter.get("/", getOrders);
orderRouter.get("/user/:userId", getUserOrders);
orderRouter.get("/:orderId/invoice", isAuth, downloadOrderInvoice);
orderRouter.put("/cancel/:orderId", cancelOrder);
orderRouter.put("/status/:orderId", updateOrderStatus);

module.exports = orderRouter;
