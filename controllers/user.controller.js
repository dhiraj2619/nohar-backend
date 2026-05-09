const { default: axios } = require("axios");
const {
  BREVO_API_KEY,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
  ORDER_OWNER_EMAIL,
  OTP_API_KEY,
  OTP_CAMPAIGN,
  OTP_ROUTE,
  OTP_SENDER_ID,
  OTP_TEMPLATE_ID,
  OTP_PE_ID,
  ANDROID_APP_SIGNATURE,
} = require("../config/config");
const Otp = require("../models/otp.model");
const User = require("../models/users.model");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000);
const normalizeEmail = (value) => String(value || "").trim();
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const normalizeAppSignature = (value) => {
  const signature = String(value || "").trim();
  return /^[A-Za-z0-9+/]{11}$/.test(signature) ? signature : "";
};
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
  const requestStartedAt = Date.now();
  const requestId = `otp-${requestStartedAt}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const { phone, appSignature } = req.body;
    const cleanPhone = normalizePhone(phone);
    const appProvidedSignature = normalizeAppSignature(appSignature);
    const envProvidedSignature = normalizeAppSignature(ANDROID_APP_SIGNATURE);

    console.info("[OTP][send:start]", {
      requestId,
      phone: maskPhone(cleanPhone),
      rawPhoneLength: String(phone || "").length,
      hasAppSignature: Boolean(appProvidedSignature),
      hasEnvSignature: Boolean(envProvidedSignature),
    });

    if (!cleanPhone) {
      console.warn("[OTP][send:validation_failed]", {
        requestId,
        reason: "missing_phone",
      });

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

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes
    const androidAppSignature = appProvidedSignature || envProvidedSignature;

    console.info("[OTP][send:signature]", {
      requestId,
      phone: maskPhone(cleanPhone),
      signatureSource: appProvidedSignature
        ? "app"
        : envProvidedSignature
          ? "env"
          : "none",
    });

    const msg = `Dear Customer Your Nohar cosmetics login OTP is ${otp} It will expire in next 10 mins. Please do not share code with anyone.${androidAppSignature}`;

    const url = `https://kutility.org/app/smsapi/index.php?key=${OTP_API_KEY}&campaign=${OTP_CAMPAIGN}&routeid=${OTP_ROUTE}&type=text&contacts=${cleanPhone}&senderid=${OTP_SENDER_ID}&msg=${encodeURIComponent(msg)}&template_id=${OTP_TEMPLATE_ID}&pe_id=${OTP_PE_ID}`;

    console.info("[OTP][send:vendor_request]", {
      requestId,
      phone: maskPhone(cleanPhone),
      campaignConfigured: Boolean(OTP_CAMPAIGN),
      routeConfigured: Boolean(OTP_ROUTE),
      senderConfigured: Boolean(OTP_SENDER_ID),
      templateConfigured: Boolean(OTP_TEMPLATE_ID),
      peConfigured: Boolean(OTP_PE_ID),
    });

    const response = await axios.get(url, { timeout: 20000 });

    console.info("[OTP][send:vendor_response]", {
      requestId,
      phone: maskPhone(cleanPhone),
      status: response?.status,
      data: summarizeVendorResponse(response?.data),
      durationMs: Date.now() - requestStartedAt,
    });

    if (!response?.data) {
      console.error("[OTP][send:vendor_invalid_response]", {
        requestId,
        phone: maskPhone(cleanPhone),
        status: response?.status,
        durationMs: Date.now() - requestStartedAt,
      });

      return res.status(502).json({
        success: false,
        message: "SMS vendor did not return a valid response",
      });
    }

    const otpRecord = await Otp.findOneAndUpdate(
      { phone: cleanPhone },
      { otp, otpExpiry },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    console.info("[OTP][send:stored]", {
      requestId,
      phone: maskPhone(cleanPhone),
      otpRecordId: otpRecord?._id,
      durationMs: Date.now() - requestStartedAt,
    });

    return res.json({
      success: true,
      message: "OTP sent successfully",
      vendorResponse: response.data,
    });
  } catch (error) {
    console.error("[OTP][send:error]", {
      requestId,
      phone: maskPhone(req.body?.phone),
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      response: summarizeVendorResponse(error?.response?.data),
      durationMs: Date.now() - requestStartedAt,
    });

    return res
      .status(500)
      .json({ success: false, message: "Failed to send OTP" });
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

    const otpRecord = await Otp.findOne({ phone: cleanPhone });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this phone number",
      });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (otpRecord.otpExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired",
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
      user: {
        _id: user._id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        profileCompleted: user.profileCompleted,
      },
      token,
    });
  } catch (error) {
    console.error("Verify OTP Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify OTP" });
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

    const { firstname, lastname, email } = req.body;

    if (!firstname || !lastname || !email) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const fullName = `${firstname} ${lastname}`.trim();

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

    return res.status(200).json({
      success: true,
      message: "Profile completed successfully",
      user: {
        _id: user._id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        profileCompleted: user.profileCompleted,
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
  verifyOTP,
  logoutUser,
  completeUserProfile,
  saveFcmToken,
  clearFcmToken,
  sendOrderEmailSms,
};
