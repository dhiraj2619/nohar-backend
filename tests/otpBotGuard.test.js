const test = require("node:test");
const assert = require("node:assert/strict");
const { isCloudflareIp, getCloudflareRelayReason } = require("../utils/otpBotGuard");

test("IPs from the attack are recognised as Cloudflare", () => {
  for (const ip of ["162.158.216.86", "172.69.176.10", "172.70.162.161", "172.64.192.206", "172.70.91.141"]) {
    assert.equal(isCloudflareIp(ip), true, ip);
  }
});

test("ordinary customer IPs and WARP are not treated as Cloudflare", () => {
  for (const ip of ["49.36.12.5", "106.51.0.1", "172.63.255.255", "172.72.0.0", "104.28.10.20", "2409:4040::1", "garbage", ""]) {
    assert.equal(isCloudflareIp(ip), false, ip);
  }
});

test("Cloudflare IPv6 addresses are recognised", () => {
  assert.equal(isCloudflareIp("2a06:98c0:3600::103"), true);
  assert.equal(isCloudflareIp("2606:4700:10::6816:1"), true);
  assert.equal(isCloudflareIp("2a09:bac1::1"), false);
});

test("the CF-Worker header is reported even from a non-Cloudflare IP", () => {
  assert.equal(getCloudflareRelayReason({ "cf-worker": "bad.dev" }, "9.9.9.9"), "Cloudflare Worker (bad.dev)");
  assert.equal(getCloudflareRelayReason({}, "9.9.9.9"), null);
});
