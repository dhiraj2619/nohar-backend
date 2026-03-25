const {
  sendOTP,
  verifyOTP,
  logoutUser,
  completeUserProfile,
} = require("../controllers/user.controller");
const { isAuth } = require("../middlewares/auth.middleware");

const userRouter = require("express").Router();

userRouter.post("/send-otp", sendOTP);
userRouter.post("/verify-otp", verifyOTP);
userRouter.post("/logout", logoutUser);
userRouter.post("/complete-profile", isAuth, completeUserProfile);

module.exports = { userRouter };
