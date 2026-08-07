const OtpAction = require("../models/otpAction.model");

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSourceFilter = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized || normalized === "all") {
    return null;
  }

  if (["app", "website", "unknown"].includes(normalized)) {
    return normalized;
  }

  return null;
};

const normalizeActionFilter = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized || normalized === "all") {
    return null;
  }

  if (["send", "resend", "verify"].includes(normalized)) {
    return normalized;
  }

  return null;
};

const getPositiveInt = (value, fallback, max = 100) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const buildOtpActionQuery = (query = {}) => {
  const filter = {};
  const phone = String(query.phone || "").replace(/\D/g, "");
  const source = normalizeSourceFilter(query.source);
  const actionType = normalizeActionFilter(query.actionType || query.action);

  if (phone) {
    filter.phone = { $regex: escapeRegex(phone), $options: "i" };
  }

  if (source) {
    filter.source = source;
  }

  if (actionType) {
    filter.actionType = actionType;
  }

  return filter;
};

const getOtpActions = async (req, res) => {
  try {
    const page = getPositiveInt(req.query.page, 1, 1000);
    const limit = getPositiveInt(req.query.limit, 25, 100);
    const skip = (page - 1) * limit;
    const filter = buildOtpActionQuery(req.query);

    const [actions, totalCount, sourceSummary, actionSummary] = await Promise.all([
      OtpAction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      OtpAction.countDocuments(filter),
      OtpAction.aggregate([
        {
          $group: {
            _id: "$source",
            count: { $sum: 1 },
          },
        },
      ]),
      OtpAction.aggregate([
        {
          $group: {
            _id: "$actionType",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const sourceCounts = {
      app: 0,
      website: 0,
      unknown: 0,
    };

    sourceSummary.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(sourceCounts, item._id)) {
        sourceCounts[item._id] = item.count || 0;
      }
    });

    const actionCounts = {
      send: 0,
      resend: 0,
      verify: 0,
    };

    actionSummary.forEach((item) => {
      if (item?._id && Object.prototype.hasOwnProperty.call(actionCounts, item._id)) {
        actionCounts[item._id] = item.count || 0;
      }
    });

    return res.status(200).json({
      success: true,
      message: "OTP actions fetched successfully",
      data: actions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
      summary: {
        sourceCounts,
        actionCounts,
      },
      filters: {
        phone: String(req.query.phone || "").trim(),
        source: normalizeSourceFilter(req.query.source) || "all",
        actionType: normalizeActionFilter(req.query.actionType || req.query.action) || "all",
      },
    });
  } catch (error) {
    console.error("Get OTP actions error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch OTP actions",
      error: error.message,
    });
  }
};

module.exports = {
  getOtpActions,
};
