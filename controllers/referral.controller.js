const ReferralVisit = require("../models/referralVisit.model");
const { REFERRAL_SOURCES } = require("../models/referralVisit.model");

// A visitor landing repeatedly inside this window counts as one redirect.
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const clip = (value, max) => String(value || "").trim().slice(0, max);

const normalizeSource = (value) => {
  const source = String(value || "").trim().toUpperCase();
  return REFERRAL_SOURCES.includes(source) ? source : null;
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const trackReferralVisit = async (req, res) => {
  try {
    const source = normalizeSource(req.body?.source);

    if (!source) {
      return res.status(400).json({
        success: false,
        message: "Unknown referral source",
      });
    }

    const visitorId = /^[a-z0-9-]{8,64}$/i.test(String(req.body?.visitorId || ""))
      ? String(req.body.visitorId)
      : null;

    if (visitorId) {
      const recent = await ReferralVisit.exists({
        source,
        visitorId,
        createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      });

      if (recent) {
        return res.status(200).json({ success: true, counted: false });
      }
    }

    await ReferralVisit.create({
      source,
      visitorId,
      landingPath: clip(req.body?.landingPath, 500),
      referrer: clip(req.body?.referrer, 500),
      userAgent: clip(req.headers["user-agent"], 300),
    });

    return res.status(201).json({ success: true, counted: true });
  } catch (error) {
    console.error("Track referral visit error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to track referral visit",
    });
  }
};

const getReferralStats = async (req, res) => {
  try {
    const source = normalizeSource(req.query.source || "SHRISAMARTH");

    if (!source) {
      return res.status(400).json({
        success: false,
        message: "Unknown referral source",
      });
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const match = { source };

    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lt = to;
    }

    // Daily buckets follow the admin's timezone so they line up with the picked dates.
    const timezone = clip(req.query.timezone, 64) || "Asia/Kolkata";

    const [summary] = await ReferralVisit.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                visitors: { $addToSet: "$visitorId" },
                lastVisitAt: { $max: "$createdAt" },
              },
            },
          ],
          daily: [
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone,
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const totals = summary?.totals?.[0];

    return res.status(200).json({
      success: true,
      data: {
        source,
        total: totals?.total || 0,
        uniqueVisitors: (totals?.visitors || []).filter(Boolean).length,
        lastVisitAt: totals?.lastVisitAt || null,
        daily: (summary?.daily || []).map((item) => ({
          date: item._id,
          count: item.count,
        })),
      },
    });
  } catch (error) {
    console.error("Get referral stats error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch referral stats",
      error: error.message,
    });
  }
};

module.exports = {
  trackReferralVisit,
  getReferralStats,
};
