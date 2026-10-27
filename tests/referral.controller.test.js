const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const load = (model) => {
  model.REFERRAL_SOURCES = ["SHRISAMARTH"];
  const context = { module: { exports: {} }, require: () => model, console, Date };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/referral.controller"), "utf8"), context);
  return context.module.exports;
};

const response = () => {
  const res = { status(code) { res.code = code; return res; }, json(body) { res.body = body; return res; } };
  return res;
};

test("referral visit rejects unknown sources and dedupes a returning visitor", async () => {
  const created = [];
  let recent = null;
  const controller = load({
    exists: async () => recent,
    create: async (doc) => created.push(doc),
  });
  const body = { source: "shrisamarth", visitorId: "abcdef12-3456", landingPath: "/collections/x?name=Samarth" };

  let res = response();
  await controller.trackReferralVisit({ body: { source: "google" }, headers: {} }, res);
  assert.equal(res.code, 400);

  res = response();
  await controller.trackReferralVisit({ body, headers: { "user-agent": "ua" } }, res);
  assert.equal(res.code, 201);
  assert.equal(created[0].source, "SHRISAMARTH");

  recent = { _id: "x" };
  res = response();
  await controller.trackReferralVisit({ body, headers: {} }, res);
  assert.equal(res.body.counted, false);
  assert.equal(created.length, 1);
});

test("referral stats filters by the requested range and summarizes", async () => {
  let pipeline;
  const controller = load({
    aggregate: async (value) => {
      pipeline = value;
      return [{
        totals: [{ total: 3, visitors: ["a", "b", null], lastVisitAt: "2026-10-20T10:00:00.000Z" }],
        daily: [{ _id: "2026-10-19", count: 1 }, { _id: "2026-10-20", count: 2 }],
      }];
    },
  });
  const res = response();
  await controller.getReferralStats({ query: { from: "2026-10-18T18:30:00.000Z", to: "2026-10-20T18:30:00.000Z" } }, res);

  assert.equal(res.code, 200);
  assert.equal(pipeline[0].$match.source, "SHRISAMARTH");
  assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(), "2026-10-18T18:30:00.000Z");
  assert.equal(res.body.data.total, 3);
  assert.equal(res.body.data.uniqueVisitors, 2);
  assert.equal(res.body.data.daily.length, 2);
});
