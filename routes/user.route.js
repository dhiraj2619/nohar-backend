const { sendOTP, verifyOTP } = require("../controllers/user.controller");

const userRouter = require("express").Router();

userRouter.post("/send-otp", sendOTP);
userRouter.post("/verify-otp", verifyOTP);

module.exports = { userRouter };
