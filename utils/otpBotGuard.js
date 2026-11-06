// The API is served straight from Railway, not through Cloudflare, so the real
// app and website never reach it from a Cloudflare address. A request that does
// was relayed by a Cloudflare Worker, which bots use to get a fresh IP on every
// call. Blocking those IPs one at a time cannot keep up, so the whole network is
// refused here.
//
// Source: https://www.cloudflare.com/ips/ . 104.24.0.0/14 is left out because
// Cloudflare WARP, a consumer VPN that real customers may use, leaves from it.
const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const ipv4ToInt = (ip) => {
  const parts = String(ip).split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return null;
    }

    value = value * 256 + Number(part);
  }

  return value;
};

const ipv6ToBigInt = (ip) => {
  const address = String(ip).split("%")[0].toLowerCase();

  if (!address.includes(":")) {
    return null;
  }

  const halves = address.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = halves[0] ? halves[0].split(":") : [];
  let groups = head;

  if (halves.length === 2) {
    const tail = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;

    if (missing < 1) {
      return null;
    }

    groups = [...head, ...new Array(missing).fill("0"), ...tail];
  }

  if (groups.length !== 8) {
    return null;
  }

  let value = 0n;

  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }

    value = (value << 16n) | BigInt(parseInt(group, 16));
  }

  return value;
};

const ipv4Ranges = CLOUDFLARE_IPV4_RANGES.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));

  return { start: Math.floor(ipv4ToInt(base) / size) * size, size };
});

const ipv6Ranges = CLOUDFLARE_IPV6_RANGES.map((cidr) => {
  const [base, bits] = cidr.split("/");
  const shift = BigInt(128 - Number(bits));

  return { prefix: ipv6ToBigInt(base) >> shift, shift };
});

const isCloudflareIp = (ip) => {
  const v4 = ipv4ToInt(ip);

  if (v4 !== null) {
    return ipv4Ranges.some(({ start, size }) => v4 >= start && v4 < start + size);
  }

  const v6 = ipv6ToBigInt(ip);

  if (v6 !== null) {
    return ipv6Ranges.some(({ prefix, shift }) => v6 >> shift === prefix);
  }

  return false;
};

// Returns why the request looks relayed, or null. Cloudflare adds CF-Worker to
// every request a Worker makes and does not let the Worker remove it. Its value
// is the Worker owner's domain, which can be reported to abuse@cloudflare.com.
const getCloudflareRelayReason = (headers = {}, ipAddress = null) => {
  const workerZone = String(headers?.["cf-worker"] || "").trim().slice(0, 120);

  if (workerZone) {
    return `Cloudflare Worker (${workerZone})`;
  }

  if (ipAddress && isCloudflareIp(ipAddress)) {
    return "Cloudflare IP";
  }

  return null;
};

module.exports = {
  getCloudflareRelayReason,
  isCloudflareIp,
};
