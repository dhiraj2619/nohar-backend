const { createOrder, verifyPayment } = require("../controllers/payment.controller");

const paymentRouter = require("express").Router();

paymentRouter.post("/create-order", createOrder);
paymentRouter.post("/verify", verifyPayment);

module.exports = { paymentRouter };
