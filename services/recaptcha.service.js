const { default: axios } = require("axios");
const {
  RECAPTCHA_PROJECT_ID,
  RECAPTCHA_API_KEY,
  RECAPTCHA_ANDROID_SITE_KEY,
  RECAPTCHA_WEB_SITE_KEY,
  RECAPTCHA_MIN_SCORE,
  RECAPTCHA_REQUIRED,
} = require("../config/config");

const SEND_OTP_ACTION = "send_otp";

const isRecaptchaConfigured = () =>
  Boolean(RECAPTCHA_PROJECT_ID && RECAPTCHA_API_KEY);

const getSiteKeyForSource = (source) =>
  source === "website" ? RECAPTCHA_WEB_SITE_KEY : RECAPTCHA_ANDROID_SITE_KEY;

// Returns { allowed, reason, score }.
// Missing tokens are allowed unless RECAPTCHA_REQUIRED=true, so older app and
// website versions keep working during rollout. If Google cannot be reached we
// fail open (and log) rather than block every login.
const verifySendOtpRecaptcha = async ({ token, source }) => {
  if (!isRecaptchaConfigured()) {
    return { allowed: true, reason: "not_configured" };
  }

  const siteKey = getSiteKeyForSource(source);

  if (!token || !siteKey) {
    return RECAPTCHA_REQUIRED
      ? { allowed: false, reason: token ? "site_key_missing" : "token_missing" }
      : { allowed: true, reason: token ? "site_key_missing" : "token_missing" };
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

    if (score < RECAPTCHA_MIN_SCORE) {
      return { allowed: false, reason: "low_score", score };
    }

    return { allowed: true, reason: "passed", score };
  } catch (error) {
    console.error("reCAPTCHA assessment failed:", error?.response?.data || error.message);
    return { allowed: true, reason: "assessment_error" };
  }
};

module.exports = {
  verifySendOtpRecaptcha,
};
