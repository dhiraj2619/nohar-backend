const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const load = ({ blockedIps = [], calls }) => {
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

test("pages past 1000 are not silently capped", async () => {
  const { res, calls } = await run({ query: { page: "1500", limit: "20" } });

  assert.equal(res.body.pagination.page, 1500);
  assert.equal(calls.skip, 1499 * 20);
});
