const crypto = require("node:crypto");

// Cloudflare is the API's front door. A Cloudflare Transform Rule adds this
// header, with a secret value, to every request it forwards. Railway's public
// *.up.railway.app address skips Cloudflare, so requests sent there arrive
// without it.
const ORIGIN_AUTH_HEADER = "x-origin-auth";
const MIN_SECRET_LENGTH = 32;
const DIRECT_REPORT_INTERVAL_MS = 5 * 60 * 1000;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

// Hashing first gives both sides the same length, so timingSafeEqual can
// compare them without leaking how much of the secret matched.
const secretMatches = (provided, expectedDigest) =>
  Boolean(provided) && crypto.timingSafeEqual(digest(provided), expectedDigest);

const createCloudflareEdgeGuard = ({ secret, enforce, logger = console } = {}) => {
  const usableSecret = secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;

  if (secret && !usableSecret) {
    logger.error(
      `CLOUDFLARE_ORIGIN_SECRET is shorter than ${MIN_SECRET_LENGTH} characters and is ignored.`,
    );
  }

  // Enforcing without a secret would refuse every request, including real ones.
  const enforcing = Boolean(enforce && usableSecret);

  if (enforce && !usableSecret) {
    logger.error(
      "CLOUDFLARE_ORIGIN_ENFORCE is on but no valid CLOUDFLARE_ORIGIN_SECRET is set. Direct requests are NOT being blocked.",
    );
  }

  const expectedDigest = usableSecret ? digest(usableSecret) : null;
  let directCount = 0;
  let lastReportAt = Date.now();

  const reportDirectTraffic = () => {
    directCount += 1;
    const now = Date.now();

    if (now - lastReportAt >= DIRECT_REPORT_INTERVAL_MS) {
      logger.warn(
        `[edge] ${directCount} request(s) reached the API without passing through Cloudflare in the last ${Math.round((now - lastReportAt) / 60000)} min${enforcing ? " (blocked)" : ""}.`,
      );
      directCount = 0;
      lastReportAt = now;
    }
  };

  return (req, res, next) => {
    const provided = req.headers?.[ORIGIN_AUTH_HEADER];
    const viaEdge = Boolean(expectedDigest && secretMatches(provided, expectedDigest));

    // Set by the server, never read from the request, so a caller cannot fake it.
    req.viaCloudflareEdge = viaEdge;
    // Nothing downstream needs the secret, so it is never logged or stored.
    delete req.headers[ORIGIN_AUTH_HEADER];

    if (viaEdge) {
      return next();
    }

    reportDirectTraffic();

    if (!enforcing) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: "DIRECT_ACCESS_BLOCKED",
      message: "Access blocked",
    });
  };
};

module.exports = {
  createCloudflareEdgeGuard,
  ORIGIN_AUTH_HEADER,
};
