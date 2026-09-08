const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("lead listing returns later pages, searches literally, and sweeps before reading", async () => {
  const calls = [];
  const query = {};
  const model = {
    find(filter) {
      calls.push("find"); query.filter = filter;
      return {
        select() { return this; }, sort() { return this; },
        skip(value) { query.skip = value; return this; },
        limit(value) { query.limit = value; return Promise.resolve([{ _id: "lead-31" }]); },
      };
    },
    countDocuments() { return Promise.resolve(65); },
  };
  const context = {
    module: { exports: {} }, process: { env: {} },
    require: (name) => name.includes("models/") ? model : { markStaleCartsAbandoned: async () => calls.push("sweep") },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/lead.controller"), "utf8"), context);
  let status, body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; } };
  await context.module.exports.getLeads({ query: { page: "2", limit: "30", leadType: "ACTIVE_CART", search: "+91 (test)" } }, res);
  assert.equal(status, 200);
  assert.equal(calls[0], "sweep");
  assert.equal(query.skip, 30);
  assert.equal(query.limit, 30);
  assert.equal(query.filter.$or[0].contact.$regex, "\\+91 \\(test\\)");
  assert.equal(body.pagination.total, 65);
  assert.equal(body.pagination.pages, 3);
  assert.equal(body.data[0]._id, "lead-31");
  await context.module.exports.getLeads({ query: { page: "nope", limit: "Infinity" } }, res);
  assert.equal(query.skip, 0);
  assert.equal(query.limit, 30);
});

test("malformed cart sync rejects without calling cart service", async () => {
  const context = { module: { exports: {} }, require: () => ({ syncUserCartLead: () => { throw new Error("must not be called"); } }) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/lead.controller"), "utf8"), context);
  let status;
  await context.module.exports.syncCartLead({ body: {} }, { status(code) { status = code; return this; }, json() {} });
  assert.equal(status, 400);
});

test("guest cart access requires its secret and supplied auth always gets verified", () => {
  const routes = {};
  const router = { post(path, ...handlers) { routes[path] = handlers; }, get() {} };
  let authenticated = 0;
  const context = { module: { exports: {} }, require: (name) => {
    if (name === "express") return { Router: () => router };
    if (name.includes("auth.middleware")) return { isAuth: () => authenticated++, isAdminAuth: () => {} };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../routes/lead.route"), "utf8"), context);
  const auth = routes["/cart/sync"][0];
  let status, next = 0;
  const res = { status(code) { status = code; return this; }, json() {} };
  auth({ headers: {}, body: {} }, res, () => next++);
  assert.equal(status, 400);
  auth({ headers: {}, body: { guestCartToken: "a".repeat(64) } }, res, () => next++);
  assert.equal(next, 1);
  auth({ headers: { authorization: "Bearer invalid" }, body: { guestCartToken: "a".repeat(64) } }, res, () => next++);
  assert.equal(authenticated, 1);
  assert.equal(next, 1);
});
