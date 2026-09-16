const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("lead deletion handles each type, invalid IDs, missing records and database failures", async () => {
  let stored = null;
  let calls = 0;
  let fail = false;
  const id = "507f1f77bcf86cd799439011";
  const Lead = { async findByIdAndDelete(value) { calls++; assert.equal(value, id); if (fail) throw new Error("db"); const result = stored; stored = null; return result; } };
  const context = { module: { exports: {} }, require: name => name.includes("models/") ? Lead : {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/lead.controller"), "utf8"), context);
  const run = async value => {
    let status, body;
    await context.module.exports.deleteLead({ params: { id: value } }, { status(code) { status = code; return this; }, json(data) { body = data; } });
    return { status, body };
  };
  assert.equal((await run("bad")).status, 400);
  assert.equal(calls, 0);
  for (const leadType of ["ACTIVE_CART", "ABANDONED_CART", "WHATSAPP_LEAD"]) {
    stored = { _id: id, leadType };
    const result = await run(id);
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(stored, null);
  }
  assert.equal((await run(id)).status, 404);
  fail = true;
  assert.equal((await run(id)).status, 500);
});

test("DELETE route requires admin authentication", () => {
  const admin = () => {};
  const handler = () => {};
  let registered;
  const router = { post() {}, get() {}, delete(...args) { registered = args; } };
  const context = { module: { exports: {} }, require: name => name === "express" ? { Router: () => router } : name.includes("middleware") ? { isAdminAuth: admin } : { deleteLead: handler } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../routes/lead.route"), "utf8"), context);
  assert.equal(registered[0], "/:id");
  assert.equal(registered[1], admin);
  assert.equal(registered[2], handler);
});
