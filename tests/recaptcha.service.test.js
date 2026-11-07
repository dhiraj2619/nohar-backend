const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const load = ({
  googleCalls = [],
  required = false,
  checks = [],
  config = {},
  tokenProperties = { valid: true, action: "send_otp" },
  googleError = null,
} = {}) => {
  const modules = {
    axios: {
      default: {
        post: async (url) => {
          googleCalls.push(url);
          if (googleError) throw googleError;
          return { data: { tokenProperties, riskAnalysis: { score: 0.9 } } };
        },
      },
    },
    "../config/config": {
      RECAPTCHA_PROJECT_ID: "project",
      RECAPTCHA_API_KEY: "key",
      RECAPTCHA_ANDROID_SITE_KEY: "android",
      RECAPTCHA_WEB_SITE_KEY: "web",
      RECAPTCHA_MIN_SCORE: 0.5,
      RECAPTCHA_REQUIRED: required,
      ...config,
    },
    "../models/recaptchaCheck.model": { create: async (doc) => { checks.push(doc); } },
  };
  const context = { module: { exports: {} }, require: (name) => modules[name], console, Number, Boolean };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/recaptcha.service"), "utf8"), context);
  return context.module.exports;
};

for (const [label, token] of [
  ["a short string", "abc123"],
  ["an object", { $ne: null }],
]) {
  test(`${label} is rejected as a token without calling Google`, async () => {
    const googleCalls = [];
    const { verifySendOtpRecaptcha } = load({ googleCalls });

    const result = await verifySendOtpRecaptcha({ token, source: "mobile" });

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "invalid_token_MALFORMED");
    assert.equal(googleCalls.length, 0);
  });
}

test("a full length token is still checked with Google", async () => {
  const googleCalls = [];
  const { verifySendOtpRecaptcha } = load({ googleCalls });

  const result = await verifySendOtpRecaptcha({ token: "a".repeat(600), source: "mobile" });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "passed");
  assert.equal(googleCalls.length, 1);
});

test("a missing token is still allowed while RECAPTCHA_REQUIRED is off", async () => {
  const googleCalls = [];
  const { verifySendOtpRecaptcha } = load({ googleCalls });

  const result = await verifySendOtpRecaptcha({ token: null, source: "mobile" });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "token_missing");
  assert.equal(googleCalls.length, 0);
});

test("a check scored by Google is recorded as assessed", async () => {
  const checks = [];
  const { verifySendOtpRecaptcha } = load({ checks });

  await verifySendOtpRecaptcha({ token: "a".repeat(600), source: "mobile" });

  assert.equal(checks.length, 1);
  assert.equal(checks[0].reason, "passed");
  assert.equal(checks[0].allowed, true);
  assert.equal(checks[0].assessed, true);
});

test("a check is recorded with the phone and IP so failures can be limited", async () => {
  const checks = [];
  const { verifySendOtpRecaptcha } = load({ checks });

  await verifySendOtpRecaptcha({ token: "abc123", source: "mobile", phone: "9876543210", ipAddress: "1.2.3.4" });

  assert.equal(checks[0].phone, "9876543210");
  assert.equal(checks[0].ipAddress, "1.2.3.4");
});

test("a check rejected without calling Google is recorded as not assessed", async () => {
  const checks = [];
  const { verifySendOtpRecaptcha } = load({ checks });

  await verifySendOtpRecaptcha({ token: "abc123", source: "mobile" });

  assert.equal(checks[0].reason, "invalid_token_MALFORMED");
  assert.equal(checks[0].allowed, false);
  assert.equal(checks[0].assessed, false);
});

const TOKEN = "a".repeat(600);

test("a Google outage blocks the send by default", async () => {
  const { verifySendOtpRecaptcha } = load({ googleError: new Error("timeout") });

  const result = await verifySendOtpRecaptcha({ token: TOKEN, source: "app" });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "assessment_error");
});

test("RECAPTCHA_FAIL_OPEN lets sends through during a Google outage", async () => {
  const { verifySendOtpRecaptcha } = load({
    googleError: new Error("timeout"),
    config: { RECAPTCHA_FAIL_OPEN: true },
  });

  const result = await verifySendOtpRecaptcha({ token: TOKEN, source: "app" });

  assert.equal(result.allowed, true);
});

test("a missing reCAPTCHA setup blocks sends when reCAPTCHA is required", async () => {
  const googleCalls = [];
  const { verifySendOtpRecaptcha } = load({
    googleCalls,
    required: true,
    config: { RECAPTCHA_PROJECT_ID: undefined },
  });

  const result = await verifySendOtpRecaptcha({ token: TOKEN, source: "app" });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(googleCalls.length, 0);
});

test("a token minted for another Android app is refused", async () => {
  const config = { RECAPTCHA_ANDROID_PACKAGE_NAME: "com.nohar" };
  const other = load({
    config,
    tokenProperties: { valid: true, action: "send_otp", androidPackageName: "com.evil" },
  });
  const ours = load({
    config,
    tokenProperties: { valid: true, action: "send_otp", androidPackageName: "com.nohar" },
  });

  assert.equal((await other.verifySendOtpRecaptcha({ token: TOKEN, source: "app" })).reason, "package_mismatch");
  assert.equal((await ours.verifySendOtpRecaptcha({ token: TOKEN, source: "app" })).allowed, true);
});

test("a website token from another hostname is refused", async () => {
  const config = { RECAPTCHA_WEB_HOSTNAMES: ["nohar.in", "www.nohar.in"] };
  const other = load({
    config,
    tokenProperties: { valid: true, action: "send_otp", hostname: "evil.example" },
  });
  const ours = load({
    config,
    tokenProperties: { valid: true, action: "send_otp", hostname: "www.nohar.in" },
  });

  assert.equal((await other.verifySendOtpRecaptcha({ token: TOKEN, source: "website" })).reason, "hostname_mismatch");
  assert.equal((await ours.verifySendOtpRecaptcha({ token: TOKEN, source: "website" })).allowed, true);
});
