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
  recaptchaCalls = [],
  blockedIpFilters = [],
  providerResponse = { status: 200, data: { return: true, request_id: "r1" } },
}) => {
  const modules = {
    axios: { default: { post: async (url) => { providerCalls.push(url); return providerResponse; } } },
    crypto: { randomUUID: () => "uuid" },
    "google-auth-library": { OAuth2Client: function OAuth2Client() {} },
    "../config/config": { FAST2SMS_API_KEY: "k", FAST2SMS_OTP_ID: "id", MIN_OTP_APP_BUILD_CODE: 24 },
    "../models/otp.model": otp,
    "../models/otpAction.model": { create: async () => {}, countDocuments: async () => 0, distinct: async () => [], find: () => findQuery([]), ...otpAction },
    "../models/otpBlockedIp.model": { findOne: (filter) => { blockedIpFilters.push(filter); return query(null); } },
    "../models/users.model": {},
    "../utils/otpBlockFilter": require("../utils/otpBlockFilter"),
    "../utils/otpBotGuard": require("../utils/otpBotGuard"),
    "../services/rewards.service": {},
    "../services/recaptcha.service": {
      verifySendOtpRecaptcha: async (args) => { recaptchaCalls.push(args); return recaptcha; },
    },
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
  headers: { "user-agent": "Mozilla/5.0 Chrome", "x-real-ip": ip },
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

test("IP limits use Railway's x-real-ip and ignore headers a caller can fake", async () => {
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
  req.headers["x-forwarded-for"] = "5.6.7.9";
  const res = response();
  await controller.sendOTP(req, res);

  assert.equal(res.code, 429);
  assert.equal(seenIps[0], "9.9.9.9");
});

test("behind our Cloudflare zone, IP limits use CF-Connecting-IP", async () => {
  const seenIps = [];
  const controller = load({
    otpAction: {
      countDocuments: async (filter) => {
        if (filter.sourceIpAddress) seenIps.push(filter.sourceIpAddress);
        return filter.sourceIpAddress ? 60 : 0;
      },
    },
  });

  // x-real-ip is Cloudflare's own address once Cloudflare sits in front.
  const req = request("172.70.1.1");
  req.viaCloudflareEdge = true;
  req.headers["cf-connecting-ip"] = "49.36.12.5";
  const res = response();
  await controller.sendOTP(req, res);

  assert.equal(res.code, 429);
  assert.equal(seenIps[0], "49.36.12.5");
});

test("a Cloudflare Worker relaying through our zone is still blocked", async () => {
  const providerCalls = [];
  const controller = load({ providerCalls });

  const req = request("172.70.1.1");
  req.viaCloudflareEdge = true;
  req.headers["cf-connecting-ip"] = "2a06:98c0:3600::103";
  const res = response();
  await controller.sendOTP(req, res);

  assert.equal(res.code, 403);
  assert.equal(providerCalls.length, 0);
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

test("send-otp does not call reCAPTCHA once an IP has hit its hourly request limit", async () => {
  const recaptchaCalls = [];
  const controller = load({
    recaptchaCalls,
    otpAction: { countDocuments: async (filter) => (filter.sourceIpAddress ? 60 : 0) },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.equal(recaptchaCalls.length, 0);
});

test("resend-otp does not call reCAPTCHA once an IP has hit its hourly request limit", async () => {
  const recaptchaCalls = [];
  const controller = load({
    recaptchaCalls,
    otpAction: { countDocuments: async (filter) => (filter.sourceIpAddress ? 60 : 0) },
  });

  const res = response();
  await controller.resendOTP(request(), res);

  assert.equal(res.code, 429);
  assert.equal(recaptchaCalls.length, 0);
});

test("the blocked IP check ignores expired blocks", async () => {
  const blockedIpFilters = [];
  const controller = load({ blockedIpFilters });

  await controller.sendOTP(request(), response());

  const filter = blockedIpFilters[0];
  assert.equal(filter.ipAddress, "1.2.3.4");
  assert.equal(filter.isBlocked, true);
  assert.equal(filter.$or[0].expiresAt, null);
  assert.ok(filter.$or[1].expiresAt.$gt instanceof Date);
});

test("a failed reCAPTCHA does not use up the number's cooldown slot", async () => {
  const slotClaims = [];
  const controller = load({
    recaptcha: { allowed: false, reason: "invalid_token_MALFORMED" },
    otp: { findOneAndUpdate: async (filter) => { slotClaims.push(filter); return null; } },
  });

  const res = response();
  await controller.sendOTP(request(), res);

  assert.equal(res.code, 403);
  assert.equal(slotClaims.length, 0);
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

test("send-otp from a Cloudflare IP is blocked before the provider and logged once per number", async () => {
  const providerCalls = [];
  const created = [];
  const blockedIpFilters = [];
  const controller = load({
    providerCalls,
    blockedIpFilters,
    otpAction: { create: async (row) => { created.push(row); } },
  });

  for (const ip of ["162.158.216.86", "172.69.176.10", "172.70.162.161"]) {
    const res = response();
    await controller.sendOTP(request(ip), res);
    assert.equal(res.code, 403);
  }

  assert.equal(providerCalls.length, 0);
  assert.equal(blockedIpFilters.length, 0);
  assert.equal(created.length, 1);
  assert.match(created[0].failureReason, /^Bot blocked: request relayed through Cloudflare IP/);
});

test("a request carrying the CF-Worker header is blocked and names the Worker", async () => {
  const created = [];
  const controller = load({ otpAction: { create: async (row) => { created.push(row); } } });
  const req = request("9.9.9.9");
  req.headers["cf-worker"] = "evil.example";
  const res = response();
  await controller.verifyOTP(req, res);

  assert.equal(res.code, 403);
  assert.match(created[0].failureReason, /Cloudflare Worker \(evil\.example\)/);
});

test("repeated app-update blocks for one number are logged once per 10 minutes", async () => {
  const created = [];
  const controller = load({ otpAction: { create: async (row) => { created.push(row); } } });

  for (let i = 0; i < 3; i += 1) {
    const req = request("9.9.9.9");
    req.headers["user-agent"] = "okhttp/4.12.0";
    const res = response();
    await controller.sendOTP(req, res);
    assert.equal(res.code, 426);
  }

  assert.equal(created.length, 1);
});
