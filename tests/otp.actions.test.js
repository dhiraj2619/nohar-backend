const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const load = ({ blockedIps = [], calls, recaptchaRows = [] }) => {
  const q = Promise.resolve([]);
  q.sort = () => q;
  q.skip = (value) => { calls.skip = value; return q; };
  q.limit = () => q;
  q.lean = () => q;

  const modules = {
    "../models/otpAction.model": {
      find: (filter) => { calls.findFilter = filter; return q; },
      countDocuments: async (filter) => {
        calls.counts.push(filter);
        return filter.sourceIpAddress?.$in ? 7 : 40;
      },
      estimatedDocumentCount: async () => 100,
      aggregate: async (pipeline) => {
        calls.pipelines.push(pipeline);
        return [{ _id: pipeline[1].$group._id === "$source" ? "app" : "send", count: 40 }];
      },
    },
    "../models/otpBlockedIp.model": { distinct: async () => blockedIps },
    "../models/recaptchaCheck.model": { aggregate: async () => recaptchaRows },
    "../utils/otpBlockFilter": require("../utils/otpBlockFilter"),
  };
  const context = { module: { exports: {} }, require: (name) => modules[name], console, Date, Promise, Number, Math, String, Object, Array, Buffer, Intl };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/otp.controller"), "utf8"), context);
  return context.module.exports;
};

const run = async ({ query = {}, blockedIps = [] } = {}) => {
  const calls = { counts: [], pipelines: [] };
  const { getOtpActions } = load({ blockedIps, calls });
  const res = {
    status(code) { res.code = code; return res; },
    json(body) { res.body = JSON.parse(JSON.stringify(body)); return res; },
  };
  await getOtpActions({ query }, res);
  return { res, calls };
};

test("summary counts use the same filter as the table", async () => {
  const { res, calls } = await run({ query: { source: "app", actionType: "send" }, blockedIps: ["1.1.1.1"] });

  assert.equal(res.code, 200);
  assert.equal(calls.pipelines.length, 2);
  calls.pipelines.forEach((pipeline) => {
    assert.deepEqual(JSON.parse(JSON.stringify(pipeline[0].$match)), JSON.parse(JSON.stringify(calls.findFilter)));
  });
  assert.equal(calls.findFilter.source, "app");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.findFilter.sourceIpAddress)), { $nin: ["1.1.1.1"] });
});

test("reports the overall total and how many blocked IP rows are hidden", async () => {
  const { res } = await run({ blockedIps: ["1.1.1.1"] });

  assert.equal(res.body.summary.totalTracked, 100);
  assert.equal(res.body.summary.hiddenBlockedIpCount, 7);
  assert.equal(res.body.pagination.totalCount, 40);
});

test("a search also finds rows from blocked IPs", async () => {
  const { res, calls } = await run({ query: { search: "1.1.1.1" }, blockedIps: ["1.1.1.1"] });

  assert.equal(calls.findFilter.sourceIpAddress, undefined);
  assert.equal(res.body.summary.hiddenBlockedIpCount, 0);
});

test("the reCAPTCHA tab only returns reCAPTCHA failures and breaks them down by reason", async () => {
  const { res, calls } = await run({ query: { category: "recaptcha" }, blockedIps: ["1.1.1.1"] });

  assert.equal(calls.findFilter.failureReason.$regex, "^recaptcha_");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.findFilter.sourceIpAddress)), { $nin: ["1.1.1.1"] });
  assert.equal(calls.pipelines[2][1].$group._id, "$failureReason");
  assert.equal(res.body.filters.category, "recaptcha");
});

test("the app update tab only returns app update blocks and breaks them down by build", async () => {
  const { calls } = await run({ query: { category: "app_update" } });

  assert.equal(calls.findFilter.failureReason.$regex, "^App update required");
  assert.equal(calls.pipelines[2][1].$group._id, "$appVersionCode");
});

test("hidden blocked IP count on a tab only counts that tab's rows", async () => {
  const { calls } = await run({ query: { category: "recaptcha" }, blockedIps: ["1.1.1.1"] });
  const hiddenCount = calls.counts.find((filter) => filter.sourceIpAddress?.$in);

  assert.equal(hiddenCount.failureReason.$regex, "^recaptcha_");
});

test("the all tab has no category filter but still reports both tab counts", async () => {
  const { res, calls } = await run({ query: { category: "nonsense" } });

  assert.equal(calls.findFilter.failureReason, undefined);
  assert.equal(calls.pipelines.length, 2);
  assert.equal(res.body.filters.category, "all");
  assert.deepEqual(res.body.summary.categoryCounts, { recaptcha: 40, app_update: 40, rate_limit: 40 });
});

test("the rate limit tab only returns rate limited rows and breaks them down by reason", async () => {
  const { res, calls } = await run({ query: { category: "rate_limit" }, blockedIps: ["1.1.1.1"] });

  assert.equal(calls.findFilter.deliveryStatus, "rate_limited");
  assert.equal(calls.findFilter.failureReason, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.findFilter.sourceIpAddress)), { $nin: ["1.1.1.1"] });
  assert.equal(calls.pipelines[2][1].$group._id, "$providerResponse.reason");
  assert.equal(res.body.filters.category, "rate_limit");
});

const runRecaptchaStats = async (recaptchaRows) => {
  const { getRecaptchaStats } = load({ calls: { counts: [], pipelines: [] }, recaptchaRows });
  const res = {
    status(code) { res.code = code; return res; },
    json(body) { res.body = JSON.parse(JSON.stringify(body)); return res; },
  };
  await getRecaptchaStats({}, res);
  return res;
};

test("reCAPTCHA stats report checks that were neither passed nor blocked as skipped", async () => {
  const res = await runRecaptchaStats([{ total: 10, assessed: 7, passed: 6, blocked: 2 }]);

  assert.equal(res.code, 200);
  assert.deepEqual(res.body.data.lastHour, { total: 10, assessed: 7, passed: 6, blocked: 2, skipped: 2 });
  assert.deepEqual(res.body.data.last24Hours, { total: 10, assessed: 7, passed: 6, blocked: 2, skipped: 2 });
});

test("reCAPTCHA stats are all zero when there are no checks", async () => {
  const res = await runRecaptchaStats([]);

  assert.deepEqual(res.body.data.lastHour, { total: 0, assessed: 0, passed: 0, blocked: 0, skipped: 0 });
});

test("pages past 1000 are not silently capped", async () => {
  const { res, calls } = await run({ query: { page: "1500", limit: "20" } });

  assert.equal(res.body.pagination.page, 1500);
  assert.equal(calls.skip, 1499 * 20);
});
