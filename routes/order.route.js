const express = require("express");
const {
  createOrder,
  cancelOrder,
  getOrders,
  getUserOrders,
  updateOrderStatus,
} = require("../controllers/order.controller");

const orderRouter = express.Router();

orderRouter.post("/create", createOrder);
orderRouter.get("/", getOrders);
orderRouter.get("/user/:userId", getUserOrders);
orderRouter.put("/cancel/:orderId", cancelOrder);
orderRouter.put("/status/:orderId", updateOrderStatus);

module.exports = orderRouter;
