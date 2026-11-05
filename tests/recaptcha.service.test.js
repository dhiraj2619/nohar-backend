const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const load = ({ googleCalls = [], required = false, checks = [] } = {}) => {
  const modules = {
    axios: {
      default: {
        post: async (url) => {
          googleCalls.push(url);
          return { data: { tokenProperties: { valid: true, action: "send_otp" }, riskAnalysis: { score: 0.9 } } };
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
