const { OTP_AUTO_BLOCK_ENABLED } = require("../config/config");
const OtpBlockedIp = require("../models/otpBlockedIp.model");
const { countRecaptchaFailures } = require("./recaptcha.service");
const { isBlockActive } = require("../utils/otpBlockFilter");

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const JUNK_TOKEN_LIMIT = 3;
const FAILURE_LIMIT = 5;
const FIRST_BLOCK_MS = ONE_DAY_MS;
const REPEAT_BLOCK_MS = 7 * ONE_DAY_MS;
// An older auto-block is not held against an IP, because mobile IPs get reassigned.
const REPEAT_LOOKBACK_MS = 30 * ONE_DAY_MS;

// The real app and website do not send these. Expired tokens and low scores can
// come from real customers, so they only count toward the higher limit.
const JUNK_TOKEN_REASONS = ["invalid_token_MALFORMED", "action_mismatch"];

// An admin's unblock clears the IP's earlier failures, otherwise they would
// keep it limited or get it blocked again.
const getIpFailuresClearedAt = async (ipAddress) => {
  if (!ipAddress) {
    return null;
  }

  const block = await OtpBlockedIp.findOne({ ipAddress }).select("unblockedAt").lean();

  return block?.unblockedAt || null;
};

const getAutoBlockReason = async (ipAddress, since) => {
  const [junkCount, failureCount] = await Promise.all([
    countRecaptchaFailures({ ipAddress, reason: { $in: JUNK_TOKEN_REASONS } }, since),
    countRecaptchaFailures({ ipAddress }, since),
  ]);

  if (junkCount >= JUNK_TOKEN_LIMIT) {
    return `${junkCount} invalid reCAPTCHA tokens in 1 hour`;
  }

  if (failureCount >= FAILURE_LIMIT) {
    return `${failureCount} reCAPTCHA failures in 1 hour`;
  }

  return null;
};

// Runs after a failed reCAPTCHA check. A problem here must not change the
// response to the request, so it logs instead of throwing.
const autoBlockIpIfNeeded = async ({ ipAddress, sourceUserAgent = null }) => {
  if (!OTP_AUTO_BLOCK_ENABLED || !ipAddress) {
    return null;
  }

  try {
    const now = new Date();
    const existing = await OtpBlockedIp.findOne({ ipAddress }).lean();

    if (isBlockActive(existing, now)) {
      return null;
    }

    const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);
    const clearedAt = existing?.unblockedAt ? new Date(existing.unblockedAt) : null;
    const since = clearedAt && clearedAt > hourAgo ? clearedAt : hourAgo;
    const autoBlockReason = await getAutoBlockReason(ipAddress, since);

    if (!autoBlockReason) {
      return null;
    }

    const isRepeat =
      Boolean(existing?.autoBlocked) &&
      now.getTime() - new Date(existing.blockedAt).getTime() < REPEAT_LOOKBACK_MS;
    const expiresAt = new Date(now.getTime() + (isRepeat ? REPEAT_BLOCK_MS : FIRST_BLOCK_MS));

    const block = await OtpBlockedIp.findOneAndUpdate(
      { ipAddress },
      {
        $set: {
          isBlocked: true,
          autoBlocked: true,
          autoBlockReason,
          blockedBy: "auto",
          blockedByEmail: null,
          blockedAt: now,
          unblockedAt: null,
          expiresAt,
          source: "auto",
          sourceUserAgent,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    console.warn(`OTP auto-block: ${ipAddress} until ${expiresAt.toISOString()} (${autoBlockReason})`);

    return block;
  } catch (error) {
    // Two parallel failures can race to create the row. The first one blocked the IP.
    if (error?.code !== 11000) {
      console.error("OTP auto-block failed:", error.message);
    }

    return null;
  }
};

module.exports = {
  autoBlockIpIfNeeded,
  getIpFailuresClearedAt,
};
