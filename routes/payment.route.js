const {
  createOrder,
  markPaymentFailed,
  verifyPayment,
} = require("../controllers/payment.controller");

const paymentRouter = require("express").Router();

paymentRouter.post("/create-order", createOrder);
paymentRouter.post("/verify", verifyPayment);
paymentRouter.post("/failed", markPaymentFailed);

module.exports = { paymentRouter };
