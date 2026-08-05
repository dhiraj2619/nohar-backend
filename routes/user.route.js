const {
  checkUser,
  sendOTP,
  resendOTP,
  verifyOTP,
  googleSignIn,
  logoutUser,
  completeUserProfile,
  registerUser,
  saveFcmToken,
  clearFcmToken,
  sendOrderEmailSms,
} = require("../controllers/user.controller");
const { getUserNotifications } = require("../controllers/notification.controller");
const { isAuth } = require("../middlewares/auth.middleware");

const userRouter = require("express").Router();

userRouter.post("/check-user", checkUser);
userRouter.post("/send-otp", sendOTP);
userRouter.post("/resend-otp", resendOTP);
userRouter.post("/verify-otp", verifyOTP);
userRouter.post("/register", registerUser);
userRouter.post("/google-signin", googleSignIn);
userRouter.post("/logout", logoutUser);
userRouter.post("/complete-profile", isAuth, completeUserProfile);
userRouter.post("/sendmailsms", isAuth, sendOrderEmailSms);
userRouter.get("/notifications", isAuth, getUserNotifications);
userRouter.post("/fcm-token", isAuth, saveFcmToken);
userRouter.delete("/fcm-token", isAuth, clearFcmToken);

module.exports = { userRouter };
