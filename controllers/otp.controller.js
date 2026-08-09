const OtpAction = require("../models/otpAction.model");

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const CSV_COLUMNS = [
  ["createdAt", "Created At"],
  ["phone", "Phone"],
  ["actionType", "Action Type"],
  ["source", "Source"],
  ["status", "Status"],
  ["deliveryStatus", "Delivery Status"],
  ["providerRequestId", "Provider Request Id"],
  ["providerStatusCode", "Provider Status Code"],
  ["failureReason", "Failure Reason"],
  ["appVersionCode", "App Version Code"],
  ["appVersionName", "App Version Name"],
  ["sourceIpAddress", "Source IP Address"],
  ["sourceUserAgent", "Source User Agent"],
  ["traceId", "Trace Id"],
];

const escapeCsvValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value);

  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '""')}"`;
};

const parseIsoDateInput = (value) => {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, month, day };
};

const toIstDayStart = ({ year, month, day }) =>
  new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);

const buildDateRangeFromQuery = (query = {}) => {
  const fromInput = parseIsoDateInput(query.from || query.start || query.fromDate);
  const toInput = parseIsoDateInput(query.to || query.end || query.toDate);

  if (!fromInput && !toInput) {
    return null;
  }

  const startInput = fromInput || toInput;
  const endInput = toInput || fromInput;
  const start = toIstDayStart(startInput);
  const end = new Date(toIstDayStart(endInput).getTime() + 24 * 60 * 60 * 1000);

  if (start.getTime() > end.getTime()) {
    return null;
  }

  return { start, end };
};

const buildDateRangeFilename = (from, to) => {
  const fromLabel = String(from || "from").replace(/[^0-9-]/g, "");
  const toLabel = String(to || "to").replace(/[^0-9-]/g, "");

  return `otp-actions-${fromLabel || "from"}-to-${toLabel || "to"}`;
};

const buildOtpActionsCsv = (actions = []) => {
  const header = CSV_COLUMNS.map(([, label]) => escapeCsvValue(label)).join(",");

  const rows = actions.map((action) =>
    CSV_COLUMNS.map(([field]) => {
      const value = field === "createdAt" ? action?.createdAt : action?.[field];

      return escapeCsvValue(value);
    }).join(","),
  );

  return [header, ...rows].join("\r\n");
};

const getTodayRangeInIst = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const start = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
};

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
  const dateRange = buildDateRangeFromQuery(query);

  if (phone) {
    filter.phone = { $regex: escapeRegex(phone), $options: "i" };
  }

  if (source) {
    filter.source = source;
  }

  if (actionType) {
    filter.actionType = actionType;
  }

  if (dateRange) {
    filter.createdAt = {
      $gte: dateRange.start,
      $lt: dateRange.end,
    };
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

const wipeTodayOtpActions = async (_req, res) => {
  try {
    const { start, end } = getTodayRangeInIst();

    const result = await OtpAction.deleteMany({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Today's OTP actions deleted successfully",
      deletedCount: result?.deletedCount || 0,
      dateRange: {
        start,
        end,
      },
    });
  } catch (error) {
    console.error("Wipe today's OTP actions error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to wipe today's OTP actions",
      error: error.message,
    });
  }
};

const getOtpActionsReport = async (req, res) => {
  try {
    const dateRange = buildDateRangeFromQuery(req.query);

    if (!dateRange) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid from and to date.",
      });
    }

    const filter = buildOtpActionQuery(req.query);
    const actions = await OtpAction.find(filter).sort({ createdAt: -1 }).lean();
    const csv = buildOtpActionsCsv(actions);
    const fileName = `${buildDateRangeFilename(req.query.from || req.query.start, req.query.to || req.query.end)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(`\ufeff${csv}`);
  } catch (error) {
    console.error("Get OTP actions report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to generate OTP actions report",
      error: error.message,
    });
  }
};

const wipeOtpActionsByDateRange = async (req, res) => {
  try {
    const dateRange = buildDateRangeFromQuery(req.query);

    if (!dateRange) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid from and to date.",
      });
    }

    const result = await OtpAction.deleteMany({
      createdAt: {
        $gte: dateRange.start,
        $lt: dateRange.end,
      },
    });

    return res.status(200).json({
      success: true,
      message: "OTP actions deleted successfully",
      deletedCount: result?.deletedCount || 0,
      dateRange,
    });
  } catch (error) {
    console.error("Wipe OTP actions by range error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to wipe OTP actions by date range",
      error: error.message,
    });
  }
};

const wipeAllOtpActions = async (_req, res) => {
  try {
    const result = await OtpAction.deleteMany({});

    return res.status(200).json({
      success: true,
      message: "All OTP actions deleted successfully",
      deletedCount: result?.deletedCount || 0,
    });
  } catch (error) {
    console.error("Wipe all OTP actions error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to wipe all OTP actions",
      error: error.message,
    });
  }
};

module.exports = {
  getOtpActions,
  wipeTodayOtpActions,
  getOtpActionsReport,
  wipeOtpActionsByDateRange,
  wipeAllOtpActions,
};
