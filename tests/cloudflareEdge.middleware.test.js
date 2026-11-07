const test = require("node:test");
const assert = require("node:assert/strict");
const { createCloudflareEdgeGuard } = require("../middlewares/cloudflareEdge.middleware");

const SECRET = "s".repeat(40);
const silent = { warn: () => {}, error: () => {} };

const run = (guard, headers = {}) => {
  const req = { headers: { ...headers } };
  const res = {
    status(code) { res.code = code; return res; },
    json(body) { res.body = body; return res; },
  };
  let nextCalled = false;
  guard(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
};

test("a request carrying the secret is marked as coming through Cloudflare", () => {
  const { req, nextCalled } = run(createCloudflareEdgeGuard({ secret: SECRET, enforce: true, logger: silent }), { "x-origin-auth": SECRET });

  assert.equal(nextCalled, true);
  assert.equal(req.viaCloudflareEdge, true);
  assert.equal(req.headers["x-origin-auth"], undefined);
});

test("enforce mode refuses requests without the secret or with a wrong one", () => {
  const guard = createCloudflareEdgeGuard({ secret: SECRET, enforce: true, logger: silent });

  for (const headers of [{}, { "x-origin-auth": "wrong" }, { "x-origin-auth": SECRET + "x" }]) {
    const { req, res, nextCalled } = run(guard, headers);
    assert.equal(nextCalled, false);
    assert.equal(res.code, 403);
    assert.equal(req.viaCloudflareEdge, false);
  }
});

test("log-only mode lets direct requests through but never trusts them", () => {
  const { req, nextCalled } = run(createCloudflareEdgeGuard({ secret: SECRET, enforce: false, logger: silent }), {});

  assert.equal(nextCalled, true);
  assert.equal(req.viaCloudflareEdge, false);
});

test("enforce without a usable secret does not lock everyone out", () => {
  for (const secret of [null, "short"]) {
    const { req, nextCalled } = run(createCloudflareEdgeGuard({ secret, enforce: true, logger: silent }), { "x-origin-auth": "short" });
    assert.equal(nextCalled, true);
    assert.equal(req.viaCloudflareEdge, false);
  }
});
