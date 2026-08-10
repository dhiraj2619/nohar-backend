const OtpAction = require("../models/otpAction.model");

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const REPORT_COLUMNS = [
  ["phone", "Phone", 90],
  ["source", "Source", 90],
  ["actionType", "Action", 80],
  ["status", "Status", 90],
  ["providerRequestId", "Provider", 130],
  ["createdAt", "When", 140],
  ["context", "Context", 220],
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

const formatDateTimeInIst = (value) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const buildOtpActionsCsv = (actions = []) => {
  const header = REPORT_COLUMNS.map(([, label]) => escapeCsvValue(label)).join(",");

  const rows = actions.map((action) =>
    REPORT_COLUMNS.map(([field]) => {
      const value = getReportFieldValue(action, field);

      return escapeCsvValue(value);
    }).join(","),
  );

  return [header, ...rows].join("\r\n");
};

const getReportContext = (action = {}) =>
  [
    action?.sourceUserAgent,
    action?.sourceIpAddress ? `IP ${action.sourceIpAddress}` : null,
  ]
    .filter(Boolean)
    .join(" | ") || "-";

const getReportFieldValue = (action = {}, field) => {
  if (field === "context") {
    return getReportContext(action);
  }

  if (field === "createdAt") {
    return action?.createdAt ? formatDateTimeInIst(action.createdAt) : "";
  }

  if (field === "status") {
    return action?.deliveryStatus || action?.status || "-";
  }

  if (field === "providerRequestId") {
    return action?.providerRequestId || "-";
  }

  if (field === "source") {
    return action?.source || "unknown";
  }

  if (field === "actionType") {
    return action?.actionType || "-";
  }

  return action?.[field] || "-";
};

const PDF_PAGE_WIDTH = 842;
const PDF_PAGE_HEIGHT = 595;
const PDF_MARGIN = 24;
const PDF_HEADER_HEIGHT = 54;
const PDF_ROW_HEIGHT = 22;
const PDF_ROWS_PER_PAGE = 20;

const sanitizePdfText = (value) =>
  String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/[^\x09\x20-\x7E]/g, "?");

const escapePdfText = (value) =>
  sanitizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const pdfTopToBottomY = (topY, height = 0) => PDF_PAGE_HEIGHT - topY - height;

const fitPdfText = (value, width, fontSize = 9) => {
  const text = sanitizePdfText(value);
  const averageCharWidth = fontSize * 0.5;
  const maxChars = Math.max(6, Math.floor(width / averageCharWidth));

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
};

const createPdfTextCommand = ({ x, topY, text, size = 9, font = "F1" }) => {
  const y = pdfTopToBottomY(topY, size);

  return `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(
    text,
  )}) Tj ET`;
};

const createPdfRectCommand = ({ x, topY, width, height }) => {
  const y = pdfTopToBottomY(topY, height);

  return `${x} ${y} ${width} ${height} re S`;
};

const buildPdfObjects = (pages) => {
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontRegularId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const fontBoldId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );

  const contentIds = pages.map((pageContent) =>
    addObject(
      `<< /Length ${Buffer.byteLength(pageContent, "latin1")} >>\nstream\n${pageContent}\nendstream`,
    ),
  );

  const pageIds = pages.map((_, index) =>
    addObject(
      `<< /Type /Page /Parent __PAGES__ 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    ),
  );

  const pagesId = addObject(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  pageIds.forEach((pageId) => {
    objects[pageId - 1] = objects[pageId - 1].replace("__PAGES__", String(pagesId));
  });

  return { objects, catalogId };
};

const buildPdfBuffer = (pages) => {
  const { objects, catalogId } = buildPdfObjects(pages);
  const offsets = [0];
  const chunks = [];
  let length = 0;

  const pushChunk = (value) => {
    const chunk = Buffer.from(value, "latin1");
    chunks.push(chunk);
    length += chunk.length;
  };

  pushChunk("%PDF-1.4\n");

  objects.forEach((objectContent, index) => {
    offsets.push(length);
    pushChunk(`${index + 1} 0 obj\n${objectContent}\nendobj\n`);
  });

  const xrefStart = length;
  pushChunk(`xref\n0 ${objects.length + 1}\n`);
  pushChunk("0000000000 65535 f \n");

  for (let index = 1; index <= objects.length; index += 1) {
    pushChunk(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }

  pushChunk(`trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`);
  pushChunk(`startxref\n${xrefStart}\n%%EOF`);

  return Buffer.concat(chunks);
};

const buildOtpActionsPdf = (actions = [], meta = {}) => {
  const effectiveRowsPerPage = PDF_ROWS_PER_PAGE;
  const pageWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const baseWidth = REPORT_COLUMNS.reduce((sum, [, , width]) => sum + width, 0);
  const scale = baseWidth > 0 ? pageWidth / baseWidth : 1;
  const columnWidths = REPORT_COLUMNS.map(([, , width]) => Math.floor(width * scale));
  const widthDelta = pageWidth - columnWidths.reduce((sum, value) => sum + value, 0);
  columnWidths[columnWidths.length - 1] += widthDelta;

  const pages = [];
  const pageCount = Math.max(1, Math.ceil(actions.length / effectiveRowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageActions = actions.slice(
      pageIndex * effectiveRowsPerPage,
      pageIndex * effectiveRowsPerPage + effectiveRowsPerPage,
    );
    const commands = [];
    let topY = PDF_MARGIN;

    commands.push(
      createPdfTextCommand({
        x: PDF_MARGIN,
        topY,
        text: "OTP Actions Report",
        size: 18,
        font: "F2",
      }),
    );
    topY += 22;

    const dateRangeText =
      meta.from && meta.to
        ? `From ${meta.from} to ${meta.to}`
        : "All available OTP actions";

    commands.push(
      createPdfTextCommand({
        x: PDF_MARGIN,
        topY,
        text: `${dateRangeText} | Generated at ${new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })}`,
        size: 9,
      }),
    );
    topY += 18;

    commands.push(
      createPdfTextCommand({
        x: PDF_MARGIN,
        topY,
        text: `Page ${pageIndex + 1} of ${pageCount}`,
        size: 9,
      }),
    );
    topY += 18;

    REPORT_COLUMNS.forEach(([, label], columnIndex) => {
      const x = PDF_MARGIN + columnWidths.slice(0, columnIndex).reduce((sum, value) => sum + value, 0);
      commands.push(createPdfRectCommand({ x, topY, width: columnWidths[columnIndex], height: 20 }));
      commands.push(
        createPdfTextCommand({
          x: x + 4,
          topY: topY + 5,
          text: label,
          size: 9,
          font: "F2",
        }),
      );
    });
    topY += 20;

    pageActions.forEach((action) => {
      const values = REPORT_COLUMNS.map(([field], columnIndex) =>
        fitPdfText(getReportFieldValue(action, field) || "-", columnWidths[columnIndex] - 8),
      );

      REPORT_COLUMNS.forEach(([, , ], columnIndex) => {
        const x = PDF_MARGIN + columnWidths.slice(0, columnIndex).reduce((sum, value) => sum + value, 0);
        commands.push(createPdfRectCommand({ x, topY, width: columnWidths[columnIndex], height: PDF_ROW_HEIGHT }));
        commands.push(
          createPdfTextCommand({
            x: x + 4,
            topY: topY + 6,
            text: values[columnIndex],
            size: 8.5,
          }),
        );
      });
      topY += PDF_ROW_HEIGHT;
    });

    pages.push(commands.join("\n"));
  }

  return buildPdfBuffer(pages);
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
    const format = String(req.query.format || "csv").trim().toLowerCase();

    if (!dateRange) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid from and to date.",
      });
    }

    const filter = buildOtpActionQuery(req.query);
    const actions = await OtpAction.find(filter).sort({ createdAt: -1 }).lean();
    const fileBaseName = buildDateRangeFilename(
      req.query.from || req.query.start,
      req.query.to || req.query.end,
    );

    if (format === "pdf") {
      const pdfBuffer = await buildOtpActionsPdf(actions, { from: req.query.from || req.query.start, to: req.query.to || req.query.end });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileBaseName}.pdf"`);
      return res.status(200).send(pdfBuffer);
    }

    const csv = buildOtpActionsCsv(actions);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileBaseName}.csv"`);
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


