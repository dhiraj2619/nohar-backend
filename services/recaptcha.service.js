const { default: axios } = require("axios");
const {
  RECAPTCHA_PROJECT_ID,
  RECAPTCHA_API_KEY,
  RECAPTCHA_ANDROID_SITE_KEY,
  RECAPTCHA_WEB_SITE_KEY,
  RECAPTCHA_MIN_SCORE,
  RECAPTCHA_REQUIRED,
  RECAPTCHA_FAIL_OPEN,
  RECAPTCHA_ANDROID_PACKAGE_NAME,
  RECAPTCHA_WEB_HOSTNAMES,
} = require("../config/config");
const RecaptchaCheck = require("../models/recaptchaCheck.model");

const SEND_OTP_ACTION = "send_otp";
// Real tokens run far longer than this. Anything shorter is junk, and rejecting
// it here avoids a billable assessment.
const MIN_TOKEN_LENGTH = 100;

const isRecaptchaConfigured = () =>
  Boolean(RECAPTCHA_PROJECT_ID && RECAPTCHA_API_KEY);

const isWebsiteSource = (source) => source === "website";

const getSiteKeyForSource = (source) =>
  isWebsiteSource(source) ? RECAPTCHA_WEB_SITE_KEY : RECAPTCHA_ANDROID_SITE_KEY;

// A token is tied to the app package or website hostname it was minted for.
// Checking it stops tokens harvested from someone else's site or app build.
const getOriginMismatch = (source, tokenProperties) => {
  if (isWebsiteSource(source)) {
    const hostname = String(tokenProperties.hostname || "").toLowerCase();
    const allowed = RECAPTCHA_WEB_HOSTNAMES || [];

    return allowed.length && !allowed.includes(hostname) ? "hostname_mismatch" : null;
  }

  if (
    RECAPTCHA_ANDROID_PACKAGE_NAME &&
    tokenProperties.androidPackageName !== RECAPTCHA_ANDROID_PACKAGE_NAME
  ) {
    return "package_mismatch";
  }

  return null;
};

// Returns { allowed, reason, score }.
// Missing tokens are allowed only while RECAPTCHA_REQUIRED is off. If Google
// cannot be reached the request is refused, unless RECAPTCHA_FAIL_OPEN is on.
const assessSendOtpToken = async ({ token, source }) => {
  if (!isRecaptchaConfigured()) {
    return { allowed: !RECAPTCHA_REQUIRED, reason: "not_configured" };
  }

  const siteKey = getSiteKeyForSource(source);

  if (!token || !siteKey) {
    return {
      allowed: !RECAPTCHA_REQUIRED,
      reason: token ? "site_key_missing" : "token_missing",
    };
  }

  if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
    return { allowed: false, reason: "invalid_token_MALFORMED" };
  }

  try {
    const { data } = await axios.post(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${RECAPTCHA_PROJECT_ID}/assessments?key=${RECAPTCHA_API_KEY}`,
      {
        event: {
          token,
          siteKey,
          expectedAction: SEND_OTP_ACTION,
        },
      },
      { timeout: 8000 },
    );

    const tokenProperties = data?.tokenProperties || {};
    const score = Number(data?.riskAnalysis?.score ?? 0);

    // Google marks expired (over 2 minutes old) and reused tokens invalid.
    if (!tokenProperties.valid) {
      return {
        allowed: false,
        reason: `invalid_token_${tokenProperties.invalidReason || "unknown"}`,
        score,
      };
    }

    if (tokenProperties.action !== SEND_OTP_ACTION) {
      return { allowed: false, reason: "action_mismatch", score };
    }

    const originMismatch = getOriginMismatch(source, tokenProperties);

    if (originMismatch) {
      return { allowed: false, reason: originMismatch, score };
    }

    if (score < RECAPTCHA_MIN_SCORE) {
      return { allowed: false, reason: "low_score", score };
    }

    return { allowed: true, reason: "passed", score };
  } catch (error) {
    console.error("reCAPTCHA assessment failed:", error?.response?.data || error.message);
    return { allowed: Boolean(RECAPTCHA_FAIL_OPEN), reason: "assessment_error" };
  }
};

const recordRecaptchaCheck = async (result, { phone, ipAddress }) => {
  try {
    await RecaptchaCheck.create({
      reason: result.reason,
      allowed: result.allowed,
      // Only a response from Google carries a score.
      assessed: result.score !== undefined,
      phone: phone || null,
      ipAddress: ipAddress || null,
    });
  } catch (error) {
    console.error("reCAPTCHA check record failed:", error.message);
  }
};

const verifySendOtpRecaptcha = async ({ token, source, phone, ipAddress }) => {
  const result = await assessSendOtpToken({ token, source });

  await recordRecaptchaCheck(result, { phone, ipAddress });

  return result;
};

module.exports = {
  verifySendOtpRecaptcha,
};
