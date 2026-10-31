const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const query = (value) => {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.lean = () => q;
  return q;
};

const findQuery = (rows) => {
  const q = Promise.resolve(rows);
  q.sort = () => q;
  q.limit = () => q;
  q.select = () => q;
  q.lean = () => q;
  return q;
};

const load = ({
  otp = {},
  otpAction = {},
  providerCalls = [],
  recaptcha = { allowed: true, reason: "passed" },
  providerResponse = { status: 200, data: { return: true, request_id: "r1" } },
}) => {
  const modules = {
    axios: { default: { post: async (url) => { providerCalls.push(url); return providerResponse; } } },
    crypto: { randomUUID: () => "uuid" },
    "google-auth-library": { OAuth2Client: function OAuth2Client() {} },
    "../config/config": { FAST2SMS_API_KEY: "k", FAST2SMS_OTP_ID: "id", MIN_OTP_APP_BUILD_CODE: 24 },
    "../models/otp.model": otp,
    "../models/otpAction.model": { create: async () => {}, countDocuments: async () => 0, distinct: async () => [], find: () => findQuery([]), ...otpAction },
    "../models/otpBlockedIp.model": { findOne: () => query(null) },
    "../models/users.model": {},
    "../services/rewards.service": {},
    "../services/recaptcha.service": { verifySendOtpRecaptcha: async () => recaptcha },
  };
  const context = { module: { exports: {} }, require: (name) => modules[name], console: { ...console, info: () => {} }, Date, Promise };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/user.controller"), "utf8"), context);
  return context.module.exports;
};

const response = () => {
  const res = {
    headers: {},
    set(key, value) { res.headers[key] = value; return res; },
    status(code) { res.code = code; return res; },
    json(body) { res.body = body; if (!res.code) res.code = 200; return res; },
  };
  return res;
};

const request = (ip = "1.2.3.4") => ({
  body: { phone: "9876543210" },
  headers: { "user-agent": "Mozilla/5.0 Chrome", "x-forwarded-for": ip },
});

test("send-otp is rejected during the 30 second cooldown without calling the provider", async () => {
  const providerCalls = [];
  const lastSentAt = new Date(Date.now() - 20 * 1000 - 500);
  const controller = load({
    providerCalls,
    otp: {
      findOneAndUpdate: async () => null,
      findOne: () => query({ lastSentAt }),
    },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.equal(res.body.code, "RESEND_TOO_SOON");
  assert.match(res.body.message, /Please wait 10 seconds/);
  assert.equal(res.headers["Retry-After"], "10");
  assert.equal(providerCalls.length, 0);
});

test("send-otp is rejected once a number reaches its daily SMS cap", async () => {
  const providerCalls = [];
  const controller = load({
    providerCalls,
    otpAction: { countDocuments: async (filter) => (filter.phone ? 10 : 0) },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.match(res.body.message, /try again tomorrow/);
  assert.equal(providerCalls.length, 0);
});

test("send-otp is rejected when one IP has already targeted too many numbers", async () => {
  const providerCalls = [];
  const controller = load({
    providerCalls,
    otpAction: { distinct: async () => ["1111111111", "2222222222", "3333333333", "4444444444", "5555555555"] },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.equal(providerCalls.length, 0);
});

test("cloudflare client IP is used for IP limits instead of x-forwarded-for", async () => {
  const seenIps = [];
  const controller = load({
    otpAction: {
      countDocuments: async (filter) => {
        if (filter.sourceIpAddress) seenIps.push(filter.sourceIpAddress);
        return filter.sourceIpAddress ? 60 : 0;
      },
    },
  });

  const req = request("9.9.9.9");
  req.headers["cf-connecting-ip"] = "5.6.7.8";
  const res = response();
  await controller.sendOTP(req, res);

  assert.equal(res.code, 429);
  assert.equal(seenIps[0], "5.6.7.8");
});

test("send-otp goes to the provider when no limit is hit", async () => {
  const providerCalls = [];
  const session = { phone: "9876543210", sendCount: 0, status: "pending", firstSentAt: new Date(), save: async () => {} };
  const controller = load({
    providerCalls,
    otp: {
      findOneAndUpdate: async () => session,
      findOne: () => query(session),
    },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 200);
  assert.equal(res.body.success, true);
  assert.equal(providerCalls.length, 1);
});

test("send-otp is locked after 3 OTPs in 90 minutes until the oldest one is 90 minutes old", async () => {
  const providerCalls = [];
  const minutesAgo = (minutes) => ({ createdAt: new Date(Date.now() - minutes * 60 * 1000) });
  const controller = load({
    providerCalls,
    otpAction: { find: () => findQuery([minutesAgo(5), minutesAgo(30), minutesAgo(60)]) },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.equal(res.body.code, "OTP_LIMIT_REACHED");
  assert.equal(res.body.attemptsLeft, 0);
  // Oldest OTP was 60 minutes ago, so the number unlocks in about 30 minutes.
  assert.ok(Math.abs(res.body.retryAfterSeconds - 30 * 60) <= 2);
  assert.equal(providerCalls.length, 0);
});

test("send-otp is rejected without calling the provider when reCAPTCHA fails", async () => {
  const providerCalls = [];
  const controller = load({ providerCalls, recaptcha: { allowed: false, reason: "low_score", score: 0.1 } });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 403);
  assert.equal(res.body.code, "RECAPTCHA_FAILED");
  assert.equal(providerCalls.length, 0);
});

test("send-otp success reports how many OTPs are left in the window", async () => {
  const session = { phone: "9876543210", sendCount: 0, status: "pending", firstSentAt: new Date(), save: async () => {} };
  const controller = load({
    otp: {
      findOneAndUpdate: async () => session,
      findOne: () => query(session),
    },
    otpAction: { countDocuments: async (filter) => (filter.phone && filter.createdAt ? 1 : 0) },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 200);
  assert.equal(res.body.attemptsLeft, 2);
  assert.equal(res.body.resendAfterSeconds, 30);
});

const pendingSession = (overrides = {}) => ({
  phone: "9876543210",
  status: "pending",
  firstSentAt: new Date(),
  verifyAttempts: 0,
  save: async () => {},
  ...overrides,
});

test("verify-otp returns 400 with attempts left for a wrong OTP", async () => {
  const session = pendingSession();
  const controller = load({
    otp: { findOne: () => query(session) },
    providerResponse: { status: 200, data: { return: false, status_code: 401, message: "Invalid OTP" } },
  });

  const req = request();
  req.body.otp = "123456";
  const res = response();
  await controller.verifyOTP(req, res);

  assert.equal(res.code, 400);
  assert.equal(res.body.code, "OTP_INVALID");
  assert.equal(res.body.attemptsLeft, 4);
});

test("verify-otp stops checking with the provider after 5 wrong attempts", async () => {
  const providerCalls = [];
  const session = pendingSession({ verifyAttempts: 5 });
  const controller = load({ providerCalls, otp: { findOne: () => query(session) } });

  const req = request();
  req.body.otp = "123456";
  const res = response();
  await controller.verifyOTP(req, res);

  assert.equal(res.code, 400);
  assert.equal(res.body.code, "OTP_ATTEMPTS_EXCEEDED");
  assert.equal(session.status, "expired");
  assert.equal(providerCalls.length, 0);
});
