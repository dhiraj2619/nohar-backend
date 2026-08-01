const { default: axios } = require("axios");
const { OAuth2Client } = require("google-auth-library");
const {
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
  ORDER_OWNER_EMAIL,
  FAST2SMS_API_KEY,
  FAST2SMS_OTP_ID,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_CLIENT_IDS,
  OTP_ROUTE,
  OTP_SENDER_ID,
  OTP_TEMPLATE_ID,
} = require("../config/config");
const Otp = require("../models/otp.model");
const User = require("../models/users.model");
const { creditSignupBonus, getPointBalance } = require("../services/rewards.service");

const googleClient = new OAuth2Client();

const generateOTP = () => Math.floor(100000 + Math.random() * 900000);
const normalizeEmail = (value) => String(value || "").trim();
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const parseGoogleClientIds = () =>
  [
    GOOGLE_WEB_CLIENT_ID,
    GOOGLE_ANDROID_CLIENT_ID,
    ...(String(GOOGLE_CLIENT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)),
  ].filter(Boolean);
const maskPhone = (value) => {
  const digits = normalizePhone(value);

  if (!digits) {
    return "";
  }

  return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
};

const summarizeVendorResponse = (data) => {
  if (data === undefined || data === null) {
    return data;
  }

  if (typeof data === "string") {
    return data.slice(0, 500);
  }

  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return String(data).slice(0, 500);
  }
};

const formatCurrency = (amount) => {
  const numericAmount = Number(amount || 0);
  return `Rs. ${numericAmount.toFixed(2)}`;
};

const buildUserAuthResponse = (user) => ({
  _id: user._id,
  phone: user.phone || null,
  fullName: user.fullName || null,
  email: user.email || null,
  profileImage: user.profileImage || null,
  loginType: user.loginType,
  profileCompleted: Boolean(user.profileCompleted),
  walletBalance: getPointBalance(user),
  rewardPoints: getPointBalance(user),
  signupBonusGranted: Boolean(user.signupBonusGranted),
});

const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_TOTAL_ATTEMPTS = 5;

const getOtpWindowStart = (otpSession) =>
  otpSession?.firstSentAt ? new Date(otpSession.firstSentAt) : null;

const isOtpWindowExpired = (otpSession) => {
  const firstSentAt = getOtpWindowStart(otpSession);
  if (!firstSentAt) {
    return false;
  }

  return Date.now() - firstSentAt.getTime() > OTP_WINDOW_MS;
};

const resetOtpWindow = (otpSession, now = new Date()) => {
  otpSession.firstSentAt = now;
  otpSession.lastSentAt = now;
  otpSession.resendCount = 0;
  otpSession.sendCount = 0;
  otpSession.status = "pending";
  otpSession.otp = null;
  otpSession.otpExpiry = new Date(now.getTime() + OTP_WINDOW_MS);
  otpSession.providerRequestId = null;
};

const normalizeFast2SmsError = (error) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const message =
    data?.message ||
    data?.error ||
    error?.message ||
    "OTP provider request failed";

  return {
    status,
    data,
    message,
  };
};

const callFast2SmsOtpSend = async (mobile) =>
  axios.post(
    "https://www.fast2sms.com/dev/otp/send",
    {
      mobile,
      otp_id: String(FAST2SMS_OTP_ID || "").trim(),
    },
    {
      timeout: 20000,
      headers: {
        accept: "application/json",
        Authorization: FAST2SMS_API_KEY,
        "content-type": "application/json",
      },
    },
  );

const callFast2SmsOtpResend = async (mobile) =>
  axios.post(
    "https://www.fast2sms.com/dev/otp/resend",
    {
      mobile,
    },
    {
      timeout: 20000,
      headers: {
        accept: "application/json",
        Authorization: FAST2SMS_API_KEY,
        "content-type": "application/json",
      },
    },
  );

const callFast2SmsOtpVerify = async (mobile, otp) =>
  axios.post(
    "https://www.fast2sms.com/dev/otp/verify",
    {
      mobile,
      otp,
    },
    {
      timeout: 20000,
      headers: {
        accept: "application/json",
        Authorization: FAST2SMS_API_KEY,
        "content-type": "application/json",
      },
    },
  );

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const addBusinessDays = (dateInput, businessDays) => {
  const date = new Date(dateInput);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  let remainingDays = businessDays;

  while (remainingDays > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();

    if (day !== 0 && day !== 6) {
      remainingDays -= 1;
    }
  }

  return date;
};

const formatShortDate = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getExpectedDeliveryText = (orderDetails) => {
  const placedAt =
    orderDetails?.createdAt || orderDetails?.paidAt || new Date();
  const start = addBusinessDays(placedAt, 5);
  const end = addBusinessDays(placedAt, 7);

  if (!start || !end) {
    return "Expected to deliver within 5 to 7 business days.";
  }

  return `Expected to deliver within 5 to 7 business days (${formatShortDate(start)} - ${formatShortDate(end)}).`;
};

const getOrderItemsText = (orderDetails) =>
  (orderDetails?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;

      return `${index + 1}. ${item?.name || "Product"} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}`;
    })
    .join("\n");

const getOrderItemsHtml = (orderDetails) =>
  (orderDetails?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;

      return `<li style="margin-bottom:8px;">${index + 1}. ${escapeHtml(item?.name || "Product")} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}</li>`;
    })
    .join("");

const sendBrevoEmail = async ({ to, subject, text, html }) => {
  if (!BREVO_API_KEY) {
    throw new Error("Brevo API key is not configured");
  }

  return axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name: BREVO_SENDER_NAME,
        email: BREVO_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    },
    {
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    },
  );
};

const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      console.warn("[OTP][send:validation_failed]", {
        requestId,
        phone: maskPhone(cleanPhone),
        reason: "invalid_indian_mobile",
      });

      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    if (!FAST2SMS_API_KEY || !FAST2SMS_OTP_ID) {
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    const now = new Date();
    let otpSession = await Otp.findOne({ phone: cleanPhone });

    if (otpSession && isOtpWindowExpired(otpSession)) {
      otpSession.status = "expired";
      await otpSession.save();
      otpSession = null;
    }

    if (otpSession?.status === "pending" && otpSession.lastSentAt) {
      const cooldownElapsed = now.getTime() - new Date(otpSession.lastSentAt).getTime();

      if (cooldownElapsed < OTP_SEND_COOLDOWN_MS) {
        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another OTP",
        });
      }
    }

    if (!otpSession) {
      otpSession = new Otp({
        phone: cleanPhone,
        firstSentAt: now,
        lastSentAt: null,
        resendCount: 0,
        sendCount: 0,
        status: "pending",
      });
    }

    if ((otpSession.sendCount || 0) >= OTP_MAX_TOTAL_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "OTP limit reached. Please try again later.",
      });
    }

    if (!otpSession.firstSentAt) {
      otpSession.firstSentAt = now;
    }
    otpSession.lastSentAt = now;
    otpSession.status = "pending";
    otpSession.otpExpiry = new Date(now.getTime() + OTP_WINDOW_MS);

    await otpSession.save();

    const response = await callFast2SmsOtpSend(cleanPhone);
    const responseData = response?.data || {};

    otpSession.providerRequestId =
      responseData?.request_id ||
      responseData?.requestId ||
      otpSession.providerRequestId ||
      null;
    otpSession.sendCount = (otpSession.sendCount || 0) + 1;
    otpSession.status = "pending";
    otpSession.otpExpiry = new Date(now.getTime() + OTP_WINDOW_MS);
    await otpSession.save();

    return res.json({
      success: true,
      message: "OTP sent successfully",
      vendorResponse: responseData,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    console.error("[OTP][send:error]", {
      phone: maskPhone(req.body?.phone),
      message: normalizedError.message,
      status: normalizedError.status,
      response: summarizeVendorResponse(normalizedError.data),
    });

    return res
      .status(normalizedError.status || 500)
      .json({
        success: false,
        message: normalizedError.message || "Failed to send OTP",
      });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    if (!FAST2SMS_API_KEY || !FAST2SMS_OTP_ID) {
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    const otpSession = await Otp.findOne({ phone: cleanPhone });

    if (!otpSession) {
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this number",
      });
    }

    if (otpSession.status === "verified") {
      return res.status(400).json({
        success: false,
        message: "OTP already verified",
      });
    }

    if (isOtpWindowExpired(otpSession)) {
      otpSession.status = "expired";
      await otpSession.save();

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    const now = new Date();
    if (otpSession.lastSentAt) {
      const cooldownElapsed = now.getTime() - new Date(otpSession.lastSentAt).getTime();

      if (cooldownElapsed < OTP_SEND_COOLDOWN_MS) {
        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another OTP",
        });
      }
    }

    if ((otpSession.sendCount || 0) >= OTP_MAX_TOTAL_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "OTP limit reached. Please try again later.",
      });
    }

    otpSession.lastSentAt = now;
    await otpSession.save();

    const response = await callFast2SmsOtpResend(cleanPhone);
    const responseData = response?.data || {};

    otpSession.resendCount = (otpSession.resendCount || 0) + 1;
    otpSession.sendCount = (otpSession.sendCount || 0) + 1;
    otpSession.providerRequestId =
      responseData?.request_id ||
      responseData?.requestId ||
      otpSession.providerRequestId ||
      null;
    otpSession.status = "pending";
    otpSession.otpExpiry = new Date(now.getTime() + OTP_WINDOW_MS);
    await otpSession.save();

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
      vendorResponse: responseData,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    console.error("[OTP][resend:error]", {
      phone: maskPhone(req.body?.phone),
      message: normalizedError.message,
      status: normalizedError.status,
      response: summarizeVendorResponse(normalizedError.data),
    });

    return res.status(normalizedError.status || 500).json({
      success: false,
      message: normalizedError.message || "Failed to resend OTP",
    });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required",
      });
    }

    const cleanPhone = normalizePhone(phone);

    if (!FAST2SMS_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    const otpSession = await Otp.findOne({ phone: cleanPhone });

    if (!otpSession) {
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this phone number",
      });
    }

    const response = await callFast2SmsOtpVerify(cleanPhone, String(otp));
    const responseData = response?.data || {};

    if (responseData?.status_code && responseData.status_code !== 200) {
      return res.status(400).json({
        success: false,
        message: responseData?.message || "Invalid OTP",
      });
    }

    await Otp.deleteOne({ phone: cleanPhone });

    let user = await User.findOne({ phone: cleanPhone });

    if (!user) {
      user = await User.create({
        phone: cleanPhone,
        loginType: "otp",
        isVerified: true,
        fullName: null,
        email: null,
        profileCompleted: false,
      });
    } else {
      user.isVerified = true;

      const hasProfile = user.fullName?.trim() && user.email?.trim();

      user.profileCompleted = Boolean(hasProfile);

      await user.save();
    }

    const token = user.getJWTtoken();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      user: buildUserAuthResponse(user),
      token,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    console.error("Verify OTP Error:", normalizedError.message);

    return res.status(normalizedError.status || 500).json({
      success: false,
      message: normalizedError.message || "Failed to verify OTP",
    });
  }
};

const googleSignIn = async (req, res) => {
  try {
    const token = req.body?.idToken || req.body?.credential || req.body?.googleToken;
    const clientIds = parseGoogleClientIds();

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required",
      });
    }

    const verifyOptions = { idToken: token };

    if (clientIds.length > 0) {
      verifyOptions.audience = clientIds;
    }

    const ticket = await googleClient.verifyIdToken(verifyOptions);
    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(400).json({
        success: false,
        message: "Invalid Google credential",
      });
    }

    if (payload.email && payload.email_verified === false) {
      return res.status(400).json({
        success: false,
        message: "Google email is not verified",
      });
    }

    const googleId = String(payload.sub || "").trim();
    const email = normalizeEmail(payload.email);
    const fullName =
      String(payload.name || req.body?.name || "")
        .trim() || null;
    const profileImage =
      String(payload.picture || req.body?.profileImage || "")
        .trim() || null;

    if (!googleId) {
      return res.status(400).json({
        success: false,
        message: "Google account identifier missing",
      });
    }

    let user = await User.findOne({
      $or: [
        { googleId },
        ...(email ? [{ email }] : []),
      ],
    });

    const isNewUser = !user;

    if (!user) {
      user = new User({
        googleId,
        email: email || undefined,
        fullName,
        profileImage,
        phone: undefined,
        loginType: "google",
        isVerified: true,
        profileCompleted: Boolean(fullName && email),
      });
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
      }

      if (email && !user.email) {
        user.email = email;
      }

      if (fullName && !user.fullName) {
        user.fullName = fullName;
      }

      if (profileImage && !user.profileImage) {
        user.profileImage = profileImage;
      }

      user.loginType = "google";
      user.isVerified = true;

      if (fullName && email) {
        user.profileCompleted = true;
      }
    }

    await user.save();

    const persistedUserId = user._id;

    if (!user.signupBonusGranted) {
      try {
        await creditSignupBonus(persistedUserId);
        user = await User.findById(persistedUserId);
      } catch (bonusError) {
        console.error("Google signup bonus credit failed:", bonusError.message);
      }
    }

    const refreshedUser = user || (await User.findById(persistedUserId));
    const tokenJwt = refreshedUser.getJWTtoken();

    return res.status(200).json({
      success: true,
      message: isNewUser ? "Google sign-in successful" : "Google login successful",
      user: buildUserAuthResponse(refreshedUser),
      token: tokenJwt,
    });
  } catch (error) {
    console.error("Google Sign-In Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to sign in with Google",
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "user logged out success",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

const completeUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const { firstname, lastname, fullName: bodyFullName, email } = req.body;
    const fullName =
      bodyFullName || `${firstname || ""} ${lastname || ""}`.trim();

    if (!fullName || !email) {
      return res.status(400).json({
        success: false,
        message: "Full name and email are required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.fullName = fullName;
    user.email = email;
    user.profileCompleted = true;

    await user.save();

    if (!user.signupBonusGranted) {
      try {
        await creditSignupBonus(user._id);
      } catch (bonusError) {
        console.error("Signup bonus credit failed:", bonusError.message);
      }
    }

    const refreshedUser = await User.findById(userId).select(
      "_id phone fullName email profileCompleted walletBalance rewardPoints signupBonusGranted",
    );

    return res.status(200).json({
      success: true,
      message: "Profile completed successfully",
      user: {
        _id: refreshedUser._id,
        phone: refreshedUser.phone,
        fullName: refreshedUser.fullName,
        email: refreshedUser.email,
        profileCompleted: refreshedUser.profileCompleted,
        walletBalance: getPointBalance(refreshedUser),
        rewardPoints: getPointBalance(refreshedUser),
        signupBonusGranted: Boolean(refreshedUser.signupBonusGranted),
      },
    });
  } catch (error) {
    console.error("Complete Profile Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to complete profile" });
  }
};

const saveFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({
        success: false,
        message: "Valid FCM token is required",
      });
    }

    const normalizedToken = fcmToken.trim();

    if (!normalizedToken) {
      return res.status(400).json({
        success: false,
        message: "Valid FCM token is required",
      });
    }

    await User.findByIdAndUpdate(req.user._id, { fcmToken: normalizedToken });

    return res.status(200).json({
      success: true,
      message: "FCM token saved successfully",
    });
  } catch (error) {
    console.error("Save FCM Token Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to save FCM token",
    });
  }
};

const clearFcmToken = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { fcmToken: null });

    return res.status(200).json({
      success: true,
      message: "FCM token removed successfully",
    });
  } catch (error) {
    console.error("Clear FCM Token Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to clear FCM token",
    });
  }
};

const sendOrderEmailSms = async (req, res) => {
  try {
    const { eventType, user, orderDetails } = req.body;

    if (!eventType || !user || !orderDetails) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: eventType, user, or orderDetails",
      });
    }

    if (eventType !== "order_placed") {
      return res.status(400).json({
        success: false,
        message: "Invalid event type",
      });
    }

    const userEmail = normalizeEmail(user?.email);

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "User email is required",
      });
    }

    const customerName = user?.name || user?.fullName || "Customer";
    const orderId =
      orderDetails?.orderNumber ||
      orderDetails?.orderId ||
      orderDetails?._id ||
      "Order";
    const orderItemsText =
      getOrderItemsText(orderDetails) || "No order items available";
    const orderItemsHtml =
      getOrderItemsHtml(orderDetails) || "<li>No order items available</li>";
    const expectedDeliveryText = getExpectedDeliveryText(orderDetails);
    const shippingAddress = [
      orderDetails?.shippingInfo?.flatNo,
      orderDetails?.shippingInfo?.area,
      orderDetails?.shippingInfo?.landmark,
      orderDetails?.shippingInfo?.city,
      orderDetails?.shippingInfo?.state,
      orderDetails?.shippingInfo?.pincode,
      orderDetails?.shippingInfo?.country,
    ]
      .filter(Boolean)
      .join(", ");

    const userEmailOptions = {
      to: userEmail,
      subject: `Thank you for placing your order - ${orderId}`,
      text: [
        `Thank you for placing order to Nohar Cosmetics, your order number is ${orderId}.`,
        "Order details:",
        orderItemsText,
        expectedDeliveryText,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
          <h2>Thank you for placing your order with Nohar Cosmetics</h2>
          <p>Your order number is <strong>${escapeHtml(orderId)}</strong>.</p>
          <p><strong>Order details:</strong></p>
          <ul>${orderItemsHtml}</ul>
          <p>${escapeHtml(expectedDeliveryText)}</p>
        </div>
      `,
    };

    const adminEmailOptions = {
      to: ORDER_OWNER_EMAIL,
      subject: `New order placed - ${orderId}`,
      text: [
        "New order placed",
        `Customer name: ${customerName}`,
        `Customer email: ${userEmail}`,
        `Customer phone: ${user?.phone || "N/A"}`,
        `Order number: ${orderId}`,
        "Order details:",
        orderItemsText,
        `Shipping address: ${shippingAddress || "N/A"}`,
        `Total amount: ${formatCurrency(orderDetails?.totalPrice)}`,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
          <h2>New order placed</h2>
          <p><strong>Customer name:</strong> ${escapeHtml(customerName)}</p>
          <p><strong>Customer email:</strong> ${escapeHtml(userEmail)}</p>
          <p><strong>Customer phone:</strong> ${escapeHtml(user?.phone || "N/A")}</p>
          <p><strong>Order number:</strong> ${escapeHtml(orderId)}</p>
          <p><strong>Order details:</strong></p>
          <ul>${orderItemsHtml}</ul>
          <p><strong>Shipping address:</strong> ${escapeHtml(shippingAddress || "N/A")}</p>
          <p><strong>Total amount:</strong> ${formatCurrency(orderDetails?.totalPrice)}</p>
        </div>
      `,
    };

    await sendBrevoEmail(userEmailOptions);
    await sendBrevoEmail(adminEmailOptions);

    return res.status(200).json({
      success: true,
      message: "Order emails sent to user and admin",
    });
  } catch (error) {
    console.error("Notification error:", {
      message: error?.message,
      code: error?.code,
      response: error?.response?.data,
      status: error?.response?.status,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error?.message,
    });
  }
};

module.exports = {
  sendOTP,
  resendOTP,
  verifyOTP,
  googleSignIn,
  logoutUser,
  completeUserProfile,
  saveFcmToken,
  clearFcmToken,
  sendOrderEmailSms,
};
