const { default: axios } = require("axios");
const { randomUUID } = require("crypto");
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
  MIN_OTP_APP_BUILD_CODE,
  OTP_ROUTE,
  OTP_SENDER_ID,
  OTP_TEMPLATE_ID,
} = require("../config/config");
const Otp = require("../models/otp.model");
const OtpAction = require("../models/otpAction.model");
const User = require("../models/users.model");
const { creditSignupBonus, getPointBalance } = require("../services/rewards.service");

const googleClient = new OAuth2Client();

const generateOTP = () => Math.floor(100000 + Math.random() * 900000);
const normalizeEmail = (value) => String(value || "").trim();
const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const normalizeAuthPhone = (body = {}) =>
  normalizePhone(body?.phone || body?.mobile || body?.mobileNumber || body?.phoneNumber);

const normalizeAuthCountryCode = (body = {}) =>
  String(body?.countryCode || body?.country || "+91").trim() || "+91";

const buildProfileCompletionPayload = (body = {}) => {
  const firstname = String(body?.firstname || body?.firstName || "").trim();
  const lastname = String(body?.lastname || body?.lastName || "").trim();
  const fullName = String(body?.fullName || `${firstname} ${lastname}`.trim()).trim();
  const email = normalizeEmail(body?.email);
  const phone = normalizeAuthPhone(body);

  return {
    firstname,
    lastname,
    fullName,
    email,
    phone,
  };
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

const normalizePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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


const buildOtpTraceId = () => `otp_${Date.now()}_${randomUUID()}`;

const extractFast2SmsRequestId = (data) =>
  data?.request_id || data?.requestId || null;

const getFast2SmsStatusCode = (data, fallbackStatus) => {
  const statusCode = Number(data?.status_code || data?.statusCode || fallbackStatus || 0);
  return Number.isFinite(statusCode) && statusCode > 0 ? statusCode : null;
};

const isFast2SmsSuccess = (data, fallbackStatus) => {
  const statusCode = getFast2SmsStatusCode(data, fallbackStatus);

  if (data?.return === false || data?.success === false) {
    return false;
  }

  if (data?.return === true || data?.success === true) {
    return !statusCode || statusCode === 200;
  }

  return statusCode === 200;
};

const getFast2SmsMessage = (data, fallbackMessage = "OTP provider request failed") =>
  data?.message || data?.error || data?.description || fallbackMessage;

const APP_UPDATE_REQUIRED_MESSAGE =
  "App update required. Please update the app to continue.";

const getRequiredAppBuildCode = () =>
  Number.isFinite(Number(MIN_OTP_APP_BUILD_CODE))
    ? Number(MIN_OTP_APP_BUILD_CODE)
    : 15;

const getOtpAppBuildVersion = (sourceContext = {}) =>
  sourceContext.appVersionCode || null;

const buildAppVersionBlockDetails = (sourceContext = {}) => {
  const requiredVersionCode = getRequiredAppBuildCode();
  const appVersionCode = getOtpAppBuildVersion(sourceContext);

  return {
    blocked: true,
    requiredVersionCode,
    appVersionCode,
    appVersionName: sourceContext.appVersionName || null,
    message: APP_UPDATE_REQUIRED_MESSAGE,
  };
};

const shouldBlockOtpForAppVersion = (sourceContext = {}) => {
  if (sourceContext.source !== "app") {
    return false;
  }

  const appVersionCode = getOtpAppBuildVersion(sourceContext);
  const requiredVersionCode = getRequiredAppBuildCode();

  if (!appVersionCode) {
    return true;
  }

  return appVersionCode < requiredVersionCode;
};

const logOtpEvent = (event, details = {}) => {
  const payload = {
    at: new Date().toISOString(),
    ...details,
  };

  if (Object.prototype.hasOwnProperty.call(payload, "response")) {
    payload.response = summarizeVendorResponse(payload.response);
  }

  console.info(`[OTP][${event}]`, payload);
};
const normalizeOtpSource = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  if (["app", "android", "ios", "mobile"].some((token) => normalized.includes(token))) {
    return "app";
  }

  if (["web", "website", "browser", "desktop"].some((token) => normalized.includes(token))) {
    return "website";
  }

  return "unknown";
};

const extractAppVersionContext = (req = {}) => {
  const rawVersionCode =
    req.body?.versionCode ??
    req.body?.buildNumber ??
    req.body?.appVersionCode ??
    req.headers?.["x-app-version-code"] ??
    req.headers?.["x-client-version-code"] ??
    req.headers?.["x-build-number"] ??
    req.headers?.["x-version-code"] ??
    null;
  const rawVersionName =
    req.body?.versionName ??
    req.body?.appVersionName ??
    req.headers?.["x-app-version-name"] ??
    req.headers?.["x-client-version-name"] ??
    req.headers?.["x-version-name"] ??
    null;
  const versionCode = normalizePositiveInt(rawVersionCode);
  const versionName = String(rawVersionName || "").trim() || null;

  return {
    appVersionCode: versionCode,
    appVersionName: versionName,
    appVersionCodeRaw: rawVersionCode,
    appVersionNameRaw: rawVersionName,
  };
};

const inferOtpSourceFromUserAgent = (userAgent) => {
  const normalized = String(userAgent || "").trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  if (
    /(bot|crawler|spider|scrapy|curl|wget|postman|insomnia|axios|python-requests|node-fetch|fetch)/i.test(
      normalized,
    )
  ) {
    return "unknown";
  }

  if (/(okhttp|dart|flutter|reactnative|react native|mobile|android|iphone|ipad)/i.test(normalized)) {
    return "app";
  }

  if (/(mozilla|chrome|safari|firefox|edg|trident)/i.test(normalized)) {
    return "website";
  }

  return "unknown";
};

const resolveOtpSourceContext = (req) => {
  const requestedSource = String(
    req.body?.source ||
      req.body?.clientSource ||
      req.headers?.["x-client-source"] ||
      req.headers?.["x-app-source"] ||
      req.headers?.["x-web-source"] ||
      "",
  ).trim();
  const userAgent = String(req.headers?.["user-agent"] || "").trim().slice(0, 255) || null;
  const forwardedFor = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ipAddress =
    forwardedFor ||
    String(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "").trim() ||
    null;
  const appVersionContext = extractAppVersionContext(req);

  const source = requestedSource
    ? normalizeOtpSource(requestedSource)
    : inferOtpSourceFromUserAgent(userAgent);

  return {
    source,
    sourceRaw: requestedSource || null,
    sourceUserAgent: userAgent,
    sourceIpAddress: ipAddress,
    ...appVersionContext,
  };
};

const applyOtpSourceContext = (otpSession, sourceContext = {}) => {
  otpSession.source = sourceContext.source || otpSession.source || "unknown";
  otpSession.sourceRaw = sourceContext.sourceRaw ?? otpSession.sourceRaw ?? null;
  otpSession.sourceUserAgent = sourceContext.sourceUserAgent ?? otpSession.sourceUserAgent ?? null;
  otpSession.sourceIpAddress = sourceContext.sourceIpAddress ?? otpSession.sourceIpAddress ?? null;
  otpSession.appVersionCode = sourceContext.appVersionCode ?? otpSession.appVersionCode ?? null;
  otpSession.appVersionName = sourceContext.appVersionName ?? otpSession.appVersionName ?? null;
};

const getSignupSource = (sourceContext = {}) => sourceContext.source || "unknown";

const recordOtpAction = async ({
  phone,
  actionType,
  sourceContext = {},
  traceId = null,
  providerRequestId = null,
  providerStatusCode = null,
  deliveryStatus = null,
  status = null,
  failureReason = null,
  providerResponse = null,
}) => {
  try {
    await OtpAction.create({
      phone,
      actionType,
      source: sourceContext.source || "unknown",
      sourceRaw: sourceContext.sourceRaw || null,
    sourceUserAgent: sourceContext.sourceUserAgent || null,
    sourceIpAddress: sourceContext.sourceIpAddress || null,
    appVersionCode: sourceContext.appVersionCode ?? null,
    appVersionName: sourceContext.appVersionName || null,
    traceId,
      providerRequestId,
      providerStatusCode,
      deliveryStatus,
      status,
      failureReason,
      providerResponse,
    });
  } catch (error) {
    console.error("OTP action record failed:", error.message);
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
const OTP_MAX_TOTAL_ATTEMPTS = 5;
const buildOtpSessionDefaults = (phone, now, sourceContext = {}) => ({
  phone,
  firstSentAt: now,
  lastSentAt: now,
  resendCount: 0,
  sendCount: 0,
  status: "pending",
  otpExpiry: new Date(now.getTime() + OTP_WINDOW_MS),
  providerRequestId: null,
  source: sourceContext.source || "unknown",
  sourceRaw: sourceContext.sourceRaw || null,
  sourceUserAgent: sourceContext.sourceUserAgent || null,
  sourceIpAddress: sourceContext.sourceIpAddress || null,
});

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

const normalizeOtpGatewayStatus = status => {
  const numericStatus = Number(status);

  if (!numericStatus || numericStatus === 401 || numericStatus === 403) {
    return 502;
  }

  return numericStatus;
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

const checkUser = async (req, res) => {
  try {
    const cleanPhone = normalizeAuthPhone(req.body);
    const countryCode = normalizeAuthCountryCode(req.body);

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    const user = await User.findOne({ phone: cleanPhone });

    return res.status(200).json({
      success: true,
      exists: Boolean(user),
      mobile: cleanPhone,
      countryCode,
    });
  } catch (error) {
    console.error("Check user failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to check user",
    });
  }
};
const sendOTP = async (req, res) => {
  const traceId = buildOtpTraceId();
  const sourceContext = resolveOtpSourceContext(req);
  const source = sourceContext.source;

  try {
    const cleanPhone = normalizeAuthPhone(req.body);
    const now = new Date();

    logOtpEvent("send:attempt", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      requestedAt: now.toISOString(),
    });

    if (!cleanPhone) {
      logOtpEvent("send:validation_failed", { traceId, source, reason: "missing_phone" });
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      logOtpEvent("send:validation_failed", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        reason: "invalid_indian_mobile",
      });

      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    if (!FAST2SMS_API_KEY || !FAST2SMS_OTP_ID) {
      logOtpEvent("send:config_missing", { traceId, source, phone: maskPhone(cleanPhone) });
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    if (shouldBlockOtpForAppVersion(sourceContext)) {
      const blockDetails = buildAppVersionBlockDetails(sourceContext);

      logOtpEvent("send:app_version_blocked", {
        traceId,
        source,
        phone: maskPhone(cleanPhone),
        appVersionCode: blockDetails.appVersionCode,
        requiredVersionCode: blockDetails.requiredVersionCode,
      });

      await recordOtpAction({
        phone: cleanPhone,
        actionType: "send",
        sourceContext,
        traceId,
        deliveryStatus: "blocked",
        status: "blocked",
        failureReason: blockDetails.message,
        providerResponse: blockDetails,
      });

      return res.status(426).json({
        success: false,
        message: blockDetails.message,
        requiredVersionCode: blockDetails.requiredVersionCode,
        currentVersionCode: blockDetails.appVersionCode,
      });
    }

    let otpSession = await Otp.findOne({ phone: cleanPhone });

    if (otpSession && (otpSession.status === "verified" || isOtpWindowExpired(otpSession))) {
      if (otpSession.status !== "verified") {
        otpSession.status = "expired";
        otpSession.failureReason = "expired_before_new_send";
        await otpSession.save();
      }

      resetOtpWindow(otpSession, now);
    }

    if (!otpSession) {
      try {
        otpSession = await Otp.findOneAndUpdate(
          { phone: cleanPhone },
          { $setOnInsert: buildOtpSessionDefaults(cleanPhone, now, sourceContext) },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );
      } catch (error) {
        if (error?.code === 11000) {
          otpSession = await Otp.findOne({ phone: cleanPhone });
        } else {
          throw error;
        }
      }
    }

    applyOtpSourceContext(otpSession, sourceContext);

    if ((otpSession.sendCount || 0) >= OTP_MAX_TOTAL_ATTEMPTS) {
      logOtpEvent("send:limit_reached", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        sendCount: otpSession.sendCount || 0,
      });

      return res.status(429).json({
        success: false,
        message: "OTP limit reached. Please try again later.",
      });
    }

    const response = await callFast2SmsOtpSend(cleanPhone);
    const responseData = response?.data || {};
    const providerStatusCode = getFast2SmsStatusCode(responseData, response?.status);
    const providerRequestId = extractFast2SmsRequestId(responseData);
    const providerSuccess = isFast2SmsSuccess(responseData, response?.status);
    const expiryTime = new Date(now.getTime() + OTP_WINDOW_MS);

    otpSession.firstSentAt = otpSession.firstSentAt || now;
    otpSession.lastSentAt = now;
    otpSession.status = "pending";
    otpSession.otp = null;
    otpSession.otpExpiry = expiryTime;
    otpSession.providerRequestId = providerRequestId;
    otpSession.providerStatusCode = providerStatusCode;
    otpSession.deliveryStatus = providerSuccess ? "sent" : "failed";
    otpSession.lastProviderResponse = responseData;
    otpSession.failureReason = providerSuccess ? null : getFast2SmsMessage(responseData, "Fast2SMS send failed");

    if (providerSuccess) {
      otpSession.sendCount = (otpSession.sendCount || 0) + 1;
    }

    await otpSession.save();
    await recordOtpAction({
      phone: cleanPhone,
      actionType: "send",
      sourceContext,
      traceId,
      providerRequestId,
      providerStatusCode,
      deliveryStatus: otpSession.deliveryStatus,
      status: otpSession.status,
      failureReason: otpSession.failureReason,
      providerResponse: responseData,
    });

    logOtpEvent(providerSuccess ? "send:success" : "send:provider_failed", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      providerRequestId,
      providerStatusCode,
      deliveryStatus: otpSession.deliveryStatus,
      expiryTime: expiryTime.toISOString(),
      response: responseData,
    });

    if (!providerSuccess) {
      return res.status(providerStatusCode && providerStatusCode >= 400 ? providerStatusCode : 502).json({
        success: false,
        message: getFast2SmsMessage(responseData, "Failed to send OTP"),
        vendorResponse: responseData,
      });
    }

    return res.json({
      success: true,
      message: "OTP sent successfully",
      requestId: providerRequestId,
      expiresAt: expiryTime,
      vendorResponse: responseData,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    logOtpEvent("send:error", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      message: normalizedError.message,
      status: normalizedError.status,
      response: normalizedError.data,
    });
    await recordOtpAction({
      phone: normalizeAuthPhone(req.body),
      actionType: "send",
      sourceContext,
      traceId,
      deliveryStatus: "failed",
      failureReason: normalizedError.message,
      providerStatusCode: normalizedError.status,
      providerResponse: normalizedError.data,
    });

    return res.status(normalizeOtpGatewayStatus(normalizedError.status)).json({
      success: false,
      message: normalizedError.message || "Failed to send OTP",
    });
  }
};

const resendOTP = async (req, res) => {
  const traceId = buildOtpTraceId();
  const sourceContext = resolveOtpSourceContext(req);
  const source = sourceContext.source;

  try {
    const cleanPhone = normalizeAuthPhone(req.body);
    const now = new Date();

    logOtpEvent("resend:attempt", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      requestedAt: now.toISOString(),
    });

    if (!cleanPhone) {
      logOtpEvent("resend:validation_failed", { traceId, source, reason: "missing_phone" });
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      logOtpEvent("resend:validation_failed", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        reason: "invalid_indian_mobile",
      });

      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    if (!FAST2SMS_API_KEY || !FAST2SMS_OTP_ID) {
      logOtpEvent("resend:config_missing", { traceId, source, phone: maskPhone(cleanPhone) });
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    if (shouldBlockOtpForAppVersion(sourceContext)) {
      const blockDetails = buildAppVersionBlockDetails(sourceContext);

      logOtpEvent("resend:app_version_blocked", {
        traceId,
        source,
        phone: maskPhone(cleanPhone),
        appVersionCode: blockDetails.appVersionCode,
        requiredVersionCode: blockDetails.requiredVersionCode,
      });

      await recordOtpAction({
        phone: cleanPhone,
        actionType: "resend",
        sourceContext,
        traceId,
        deliveryStatus: "blocked",
        status: "blocked",
        failureReason: blockDetails.message,
        providerResponse: blockDetails,
      });

      return res.status(426).json({
        success: false,
        message: blockDetails.message,
        requiredVersionCode: blockDetails.requiredVersionCode,
        currentVersionCode: blockDetails.appVersionCode,
      });
    }

    const otpSession = await Otp.findOne({ phone: cleanPhone });

    if (!otpSession) {
      logOtpEvent("resend:no_session", { traceId, source, phone: maskPhone(cleanPhone) });
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this number",
      });
    }

    if (otpSession.status === "verified") {
      logOtpEvent("resend:already_verified", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        verifiedAt: otpSession.verifiedAt,
      });

      return res.status(400).json({
        success: false,
        message: "OTP already verified",
      });
    }

    if (isOtpWindowExpired(otpSession)) {
      otpSession.status = "expired";
      otpSession.failureReason = "expired_before_resend";
      await otpSession.save();

      logOtpEvent("resend:expired", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        expiryTime: otpSession.otpExpiry,
      });

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    if ((otpSession.sendCount || 0) >= OTP_MAX_TOTAL_ATTEMPTS) {
      logOtpEvent("resend:limit_reached", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        sendCount: otpSession.sendCount || 0,
      });

      return res.status(429).json({
        success: false,
        message: "OTP limit reached. Please try again later.",
      });
    }

    const response = await callFast2SmsOtpResend(cleanPhone);
    const responseData = response?.data || {};
    const providerStatusCode = getFast2SmsStatusCode(responseData, response?.status);
    const providerRequestId = extractFast2SmsRequestId(responseData) || otpSession.providerRequestId;
    const providerSuccess = isFast2SmsSuccess(responseData, response?.status);
    const expiryTime = new Date(now.getTime() + OTP_WINDOW_MS);

    otpSession.lastSentAt = now;
    otpSession.providerRequestId = providerRequestId;
    otpSession.providerStatusCode = providerStatusCode;
    otpSession.deliveryStatus = providerSuccess ? "resent" : "failed";
    otpSession.lastProviderResponse = responseData;
    otpSession.failureReason = providerSuccess ? null : getFast2SmsMessage(responseData, "Fast2SMS resend failed");

    if (providerSuccess) {
      otpSession.resendCount = (otpSession.resendCount || 0) + 1;
      otpSession.sendCount = (otpSession.sendCount || 0) + 1;
      otpSession.status = "pending";
      otpSession.otpExpiry = expiryTime;
    }

    applyOtpSourceContext(otpSession, sourceContext);
    await otpSession.save();
    await recordOtpAction({
      phone: cleanPhone,
      actionType: "resend",
      sourceContext,
      traceId,
      providerRequestId,
      providerStatusCode,
      deliveryStatus: otpSession.deliveryStatus,
      status: otpSession.status,
      failureReason: otpSession.failureReason,
      providerResponse: responseData,
    });

    logOtpEvent(providerSuccess ? "resend:success" : "resend:provider_failed", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      providerRequestId,
      providerStatusCode,
      deliveryStatus: otpSession.deliveryStatus,
      expiryTime: otpSession.otpExpiry,
      response: responseData,
    });

    if (!providerSuccess) {
      return res.status(providerStatusCode && providerStatusCode >= 400 ? providerStatusCode : 502).json({
        success: false,
        message: getFast2SmsMessage(responseData, "Failed to resend OTP"),
        vendorResponse: responseData,
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
      requestId: providerRequestId,
      expiresAt: otpSession.otpExpiry,
      vendorResponse: responseData,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    logOtpEvent("resend:error", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      message: normalizedError.message,
      status: normalizedError.status,
      response: normalizedError.data,
    });
    await recordOtpAction({
      phone: normalizeAuthPhone(req.body),
      actionType: "resend",
      sourceContext,
      traceId,
      deliveryStatus: "failed",
      failureReason: normalizedError.message,
      providerStatusCode: normalizedError.status,
      providerResponse: normalizedError.data,
    });

    return res.status(normalizeOtpGatewayStatus(normalizedError.status)).json({
      success: false,
      message: normalizedError.message || "Failed to resend OTP",
    });
  }
};

const verifyOTP = async (req, res) => {
  const traceId = buildOtpTraceId();
  const sourceContext = resolveOtpSourceContext(req);
  const source = sourceContext.source;

  try {
    const { phone, otp } = req.body;
    const cleanPhone = normalizeAuthPhone(req.body);
    const cleanOtp = String(otp || "").replace(/\D/g, "").slice(0, 6);
    const now = new Date();

    logOtpEvent("verify:attempt", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      attemptedAt: now.toISOString(),
      otpLength: cleanOtp.length,
    });

    if (!cleanPhone || !cleanOtp) {
      logOtpEvent("verify:validation_failed", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        reason: "missing_phone_or_otp",
      });

      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone) || !/^\d{6}$/.test(cleanOtp)) {
      logOtpEvent("verify:validation_failed", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        reason: "invalid_phone_or_otp_format",
      });

      return res.status(400).json({
        success: false,
        message: "Please enter a valid mobile number and 6 digit OTP",
      });
    }

    if (!FAST2SMS_API_KEY) {
      logOtpEvent("verify:config_missing", { traceId, source, phone: maskPhone(cleanPhone) });
      return res.status(500).json({
        success: false,
        message: "OTP service is not configured",
      });
    }

    const otpSession = await Otp.findOne({ phone: cleanPhone });

    if (!otpSession) {
      logOtpEvent("verify:no_session", { traceId, source, phone: maskPhone(cleanPhone) });
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this phone number",
      });
    }

    otpSession.verifyAttempts = (otpSession.verifyAttempts || 0) + 1;
    otpSession.lastVerifyAt = now;

    if (otpSession.status === "verified") {
      otpSession.failureReason = "already_verified";
      await otpSession.save();

      logOtpEvent("verify:already_verified", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        providerRequestId: otpSession.providerRequestId,
        verifiedAt: otpSession.verifiedAt,
      });

      return res.status(400).json({
        success: false,
        message: "OTP already verified",
      });
    }

    if (otpSession.status !== "pending") {
      otpSession.failureReason = `invalid_status_${otpSession.status}`;
      await otpSession.save();

      logOtpEvent("verify:invalid_status", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        status: otpSession.status,
      });

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    if (isOtpWindowExpired(otpSession)) {
      otpSession.status = "expired";
      otpSession.failureReason = "expired_before_verify";
      await otpSession.save();

      logOtpEvent("verify:expired", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        providerRequestId: otpSession.providerRequestId,
        expiryTime: otpSession.otpExpiry,
      });

      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    const response = await callFast2SmsOtpVerify(cleanPhone, cleanOtp);
    const responseData = response?.data || {};
    const providerStatusCode = getFast2SmsStatusCode(responseData, response?.status);
    const providerSuccess = isFast2SmsSuccess(responseData, response?.status);

    otpSession.providerStatusCode = providerStatusCode;
    otpSession.lastProviderResponse = responseData;

    if (!providerSuccess) {
      otpSession.failureReason = getFast2SmsMessage(responseData, "Invalid OTP");
      await otpSession.save();
      await recordOtpAction({
        phone: cleanPhone,
        actionType: "verify",
        sourceContext,
        traceId,
        providerRequestId: otpSession.providerRequestId,
        providerStatusCode,
        deliveryStatus: "failed",
        status: otpSession.status,
        failureReason: otpSession.failureReason,
        providerResponse: responseData,
      });

      logOtpEvent("verify:failed", {
        traceId,
        source,
        phone: maskPhone(req.body?.phone || req.body?.mobile),
        providerRequestId: otpSession.providerRequestId,
        providerStatusCode,
        verifyAttempts: otpSession.verifyAttempts,
        failureReason: otpSession.failureReason,
        response: responseData,
      });

      return res.status(providerStatusCode && providerStatusCode >= 400 ? providerStatusCode : 400).json({
        success: false,
        message: otpSession.failureReason || "Invalid OTP",
        vendorResponse: responseData,
      });
    }

    otpSession.status = "verified";
    otpSession.verifiedAt = now;
    otpSession.failureReason = null;
    otpSession.deliveryStatus = "verified";
    await otpSession.save();
    await recordOtpAction({
      phone: cleanPhone,
      actionType: "verify",
      sourceContext,
      traceId,
      providerRequestId: otpSession.providerRequestId,
      providerStatusCode,
      deliveryStatus: otpSession.deliveryStatus,
      status: otpSession.status,
      providerResponse: responseData,
    });

    let user = await User.findOne({ phone: cleanPhone });

    if (!user) {
      user = await User.create({
        phone: cleanPhone,
        loginType: "otp",
        signupSource: getSignupSource(sourceContext),
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

    logOtpEvent("verify:success", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      providerRequestId: otpSession.providerRequestId,
      providerStatusCode,
      verifyAttempts: otpSession.verifyAttempts,
      verifiedAt: otpSession.verifiedAt,
      response: responseData,
    });

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      user: buildUserAuthResponse(user),
      token,
    });
  } catch (error) {
    const normalizedError = normalizeFast2SmsError(error);
    logOtpEvent("verify:error", {
      traceId,
      source,
      phone: maskPhone(req.body?.phone || req.body?.mobile),
      message: normalizedError.message,
      status: normalizedError.status,
      response: normalizedError.data,
    });

    return res.status(normalizeOtpGatewayStatus(normalizedError.status)).json({
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
        signupSource: getSignupSource(resolveOtpSourceContext(req)),
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
    const userId = req.user?._id;
    const { fullName, email, phone } = buildProfileCompletionPayload(req.body);
    const cleanEmail = normalizeEmail(email);
    const targetPhone = userId ? normalizeAuthPhone({ phone: req.user?.phone }) : phone;

    if (!fullName || !cleanEmail) {
      return res.status(400).json({
        success: false,
        message: "Full name and email are required",
      });
    }

    if (!userId && !targetPhone) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    if (targetPhone && !userId) {
      const otpSession = await Otp.findOne({ phone: targetPhone });

      if (!otpSession || otpSession.status !== "verified") {
        return res.status(400).json({
          success: false,
          message: "Please verify your mobile number first",
        });
      }
    }

    let user = userId ? await User.findById(userId) : null;

    if (!user && targetPhone) {
      user = await User.findOne({ phone: targetPhone });
    }

    if (!user && targetPhone) {
      user = await User.create({
        phone: targetPhone,
        loginType: "otp",
        signupSource: getSignupSource(resolveOtpSourceContext(req)),
        isVerified: true,
        fullName: null,
        email: null,
        profileCompleted: false,
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.fullName = fullName;
    user.email = cleanEmail;
    user.profileCompleted = true;
    user.isVerified = true;

    if (targetPhone) {
      user.phone = targetPhone;
    }

    await user.save();

    if (!user.signupBonusGranted) {
      try {
        await creditSignupBonus(user._id);
      } catch (bonusError) {
        console.error("Signup bonus credit failed:", bonusError.message);
      }
    }

    const refreshedUser = await User.findById(user._id).select(
      "_id phone fullName email profileCompleted walletBalance rewardPoints signupBonusGranted",
    );
    const token = user.getJWTtoken();

    return res.status(200).json({
      success: true,
      message: userId ? "Profile completed successfully" : "User registered successfully",
      user: {
        _id: refreshedUser._id,
        phone: refreshedUser.phone,
        fullName: refreshedUser.fullName,
        email: refreshedUser.email,
        profileCompleted: refreshedUser.profileCompleted,
        walletBalance: refreshedUser.walletBalance,
        rewardPoints: refreshedUser.rewardPoints,
        signupBonusGranted: refreshedUser.signupBonusGranted,
      },
      token,
    });
  } catch (error) {
    console.error("Complete profile failed:", error);

    if (error?.code === 11000) {
      const duplicateField = Object.keys(error?.keyValue || {})[0] || "field";
      const duplicateMessage =
        duplicateField === "email"
          ? "This email id already exists"
          : duplicateField === "phone"
            ? "This mobile number already exists"
            : "Duplicate value already exists";

      return res.status(400).json({
        success: false,
        message: duplicateMessage,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to complete profile",
    });
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

const registerUser = async (req, res) => completeUserProfile(req, res);

module.exports = {
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
};








