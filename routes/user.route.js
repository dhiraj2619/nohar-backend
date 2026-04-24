const {
  sendOTP,
  verifyOTP,
  logoutUser,
  completeUserProfile,
  saveFcmToken,
  clearFcmToken,
  sendOrderEmailSms,
} = require("../controllers/user.controller");
const { isAuth } = require("../middlewares/auth.middleware");

const userRouter = require("express").Router();

userRouter.post("/send-otp", sendOTP);
userRouter.post("/verify-otp", verifyOTP);
userRouter.post("/logout", logoutUser);
userRouter.post("/complete-profile", isAuth, completeUserProfile);
userRouter.post("/sendmailsms", isAuth, sendOrderEmailSms);
userRouter.post("/fcm-token", isAuth, saveFcmToken);
userRouter.delete("/fcm-token", isAuth, clearFcmToken);

module.exports = { userRouter };
