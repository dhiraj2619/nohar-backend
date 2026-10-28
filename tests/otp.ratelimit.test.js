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

const load = ({ otp = {}, otpAction = {}, providerCalls = [] }) => {
  const modules = {
    axios: { default: { post: async (url) => { providerCalls.push(url); return { status: 200, data: { return: true, request_id: "r1" } }; } } },
    crypto: { randomUUID: () => "uuid" },
    "google-auth-library": { OAuth2Client: function OAuth2Client() {} },
    "../config/config": { FAST2SMS_API_KEY: "k", FAST2SMS_OTP_ID: "id", MIN_OTP_APP_BUILD_CODE: 24 },
    "../models/otp.model": otp,
    "../models/otpAction.model": { create: async () => {}, countDocuments: async () => 0, distinct: async () => [], ...otpAction },
    "../models/otpBlockedIp.model": { findOne: () => query(null) },
    "../models/users.model": {},
    "../services/rewards.service": {},
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

test("send-otp is rejected during the 60 second cooldown without calling the provider", async () => {
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
  assert.match(res.body.message, /Please wait 40 seconds/);
  assert.equal(res.headers["Retry-After"], "40");
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
