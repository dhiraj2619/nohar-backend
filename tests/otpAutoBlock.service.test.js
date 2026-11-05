const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const { isBlockActive, inactiveBlockFilter } = require("../utils/otpBlockFilter");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const query = (value) => {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.lean = () => q;
  return q;
};

const load = ({ existing = null, junk = 0, failures = 0, updates = [], sinceSeen = [], updateError = null, enabled = true }) => {
  const modules = {
    "../config/config": { OTP_AUTO_BLOCK_ENABLED: enabled },
    "../models/otpBlockedIp.model": {
      findOne: () => query(existing),
      findOneAndUpdate: async (filter, update, options) => {
        if (updateError) throw updateError;
        updates.push({ filter, update, options });
        return update.$set;
      },
    },
    "./recaptcha.service": {
      countRecaptchaFailures: async (filter, since) => {
        sinceSeen.push(since);
        return filter.reason ? junk : failures;
      },
    },
    "../utils/otpBlockFilter": { isBlockActive },
  };
  const context = {
    module: { exports: {} },
    require: (name) => modules[name],
    console: { ...console, warn: () => {}, error: () => {} },
    Date,
    Promise,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/otpAutoBlock.service"), "utf8"), context);
  return context.module.exports;
};

const untilMs = (update) => update.update.$set.expiresAt.getTime() - Date.now();

test("nothing is blocked while the setting is off", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ junk: 9, failures: 9, updates, enabled: false });

  assert.equal(await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" }), null);
  assert.equal(updates.length, 0);
});

test("failures under both limits do not block", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ junk: 2, failures: 4, updates });

  assert.equal(await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" }), null);
  assert.equal(updates.length, 0);
});

test("3 junk tokens in an hour block the IP for 24 hours", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ junk: 3, failures: 3, updates });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  const { $set } = updates[0].update;
  assert.equal(updates[0].filter.ipAddress, "1.2.3.4");
  assert.equal($set.isBlocked, true);
  assert.equal($set.autoBlocked, true);
  assert.match($set.autoBlockReason, /3 invalid reCAPTCHA tokens/);
  assert.ok(Math.abs(untilMs(updates[0]) - DAY) < 5000);
});

test("5 failures of any kind in an hour block the IP for 24 hours", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ junk: 0, failures: 5, updates });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  assert.match(updates[0].update.$set.autoBlockReason, /5 reCAPTCHA failures/);
  assert.ok(Math.abs(untilMs(updates[0]) - DAY) < 5000);
});

test("the auto-block text stays out of the reason shown to the blocked caller", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ failures: 5, updates });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  assert.equal("reason" in updates[0].update.$set, false);
});

test("a second auto-block within 30 days lasts 7 days", async () => {
  const updates = [];
  const existing = {
    isBlocked: true,
    autoBlocked: true,
    blockedAt: new Date(Date.now() - 3 * DAY),
    expiresAt: new Date(Date.now() - 2 * DAY),
  };
  const { autoBlockIpIfNeeded } = load({ existing, failures: 5, updates });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  assert.ok(Math.abs(untilMs(updates[0]) - 7 * DAY) < 5000);
});

test("an auto-block older than 30 days is not held against the IP", async () => {
  const updates = [];
  const existing = {
    isBlocked: true,
    autoBlocked: true,
    blockedAt: new Date(Date.now() - 40 * DAY),
    expiresAt: new Date(Date.now() - 39 * DAY),
  };
  const { autoBlockIpIfNeeded } = load({ existing, failures: 5, updates });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  assert.ok(Math.abs(untilMs(updates[0]) - DAY) < 5000);
});

test("a manual block is never changed", async () => {
  const updates = [];
  const existing = { isBlocked: true, autoBlocked: false, expiresAt: null, note: "keep" };
  const { autoBlockIpIfNeeded } = load({ existing, junk: 9, failures: 9, updates });

  assert.equal(await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" }), null);
  assert.equal(updates.length, 0);
});

test("only failures after an admin's unblock are counted", async () => {
  const sinceSeen = [];
  const unblockedAt = new Date(Date.now() - 10 * 60 * 1000);
  const existing = { isBlocked: false, unblockedAt };
  const { autoBlockIpIfNeeded } = load({ existing, sinceSeen });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  assert.equal(sinceSeen.length, 2);
  sinceSeen.forEach((since) => assert.equal(since.getTime(), unblockedAt.getTime()));
});

test("an unblock older than an hour leaves the one hour window in place", async () => {
  const sinceSeen = [];
  const existing = { isBlocked: false, unblockedAt: new Date(Date.now() - 5 * HOUR) };
  const { autoBlockIpIfNeeded } = load({ existing, sinceSeen });

  await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" });

  sinceSeen.forEach((since) => assert.ok(Math.abs(Date.now() - since.getTime() - HOUR) < 5000));
});

test("no IP means no block", async () => {
  const updates = [];
  const { autoBlockIpIfNeeded } = load({ failures: 9, updates });

  assert.equal(await autoBlockIpIfNeeded({ ipAddress: null }), null);
  assert.equal(updates.length, 0);
});

for (const [label, error] of [
  ["a database error", new Error("db down")],
  ["two parallel requests racing to create the row", Object.assign(new Error("dup"), { code: 11000 })],
]) {
  test(`${label} does not throw`, async () => {
    const { autoBlockIpIfNeeded } = load({ failures: 5, updateError: error });

    assert.equal(await autoBlockIpIfNeeded({ ipAddress: "1.2.3.4" }), null);
  });
}

test("isBlockActive treats an expired block as inactive", () => {
  const now = new Date();

  assert.equal(isBlockActive({ isBlocked: true, expiresAt: null }, now), true);
  assert.equal(isBlockActive({ isBlocked: true }, now), true);
  assert.equal(isBlockActive({ isBlocked: true, expiresAt: new Date(now.getTime() + 1000) }, now), true);
  assert.equal(isBlockActive({ isBlocked: true, expiresAt: new Date(now.getTime() - 1000) }, now), false);
  assert.equal(isBlockActive({ isBlocked: false, expiresAt: null }, now), false);
  assert.equal(isBlockActive(null, now), false);
});

test("the unblocked filter includes expired blocks", () => {
  const now = new Date();
  const filter = inactiveBlockFilter(now);

  assert.equal(filter.$or[0].isBlocked, false);
  assert.equal(filter.$or[1].isBlocked, true);
  assert.equal(filter.$or[1].expiresAt.$lte, now);
});
