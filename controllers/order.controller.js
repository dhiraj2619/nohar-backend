const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const Order = require("../models/order.model");
const ShippingInfo = require("../models/shippingInfo.model");
const Product = require("../models/products.model");
const AdminInfo = require("../models/adminInfo.model");
const User = require("../models/users.model");
const {
  MAIL_FROM,
  ORDER_OWNER_EMAIL,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} = require("../config/config");
const { sendPushToUsers } = require("../services/notification.service");

let mailTransporter;
const INVOICE_LOGO_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "invoice",
  "nohar-logo.png",
);
const DEFAULT_STORE_DETAILS = {
  storeName: "Nohar Cosmetics",
  email: "noharcosmetics@gmail.com",
  address: "Dwarka Circle, Kathe Lane, Nashik, Maharashtra, India",
  gstNumber: "27CAAPB9203J2ZX",
  authorizedSignatory: "Nohar Cosmetics",
  allowCOD: true,
  allowPartial: false,
  partialPaymentType: "PERCENT",
  partialPaymentValue: 0,
  freeShippingAbove: 0,
  maintenanceMode: false,
};

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? null : numericValue;
};

const normalizeEmail = (value) => String(value || "").trim();
const normalizeSmtpPass = (value) =>
  String(value || "")
    .replace(/\s+/g, "")
    .trim();

const ORDER_PHASES = [
  "ORDER_PLACED",
  "READY_TO_PICK",
  "IN_TRANSIT",
  "DELIVERED",
];

const normalizeOrderStatus = (status) => {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();

  const statusMap = {
    PROCESSING: "ORDER_PLACED",
    ORDER_PLACED: "ORDER_PLACED",
    READY_TO_PICK: "READY_TO_PICK",
    "READY TO PICK": "READY_TO_PICK",
    READY_FOR_PICKUP: "READY_TO_PICK",
    SHIPPED: "IN_TRANSIT",
    IN_TRANSIT: "IN_TRANSIT",
    "IN TRANSIT": "IN_TRANSIT",
    OUT_FOR_DELIVERY: "IN_TRANSIT",
    DELIVERED: "DELIVERED",
    COMPLETED: "DELIVERED",
    CANCELLED: "CANCELLED",
    CANCELED: "CANCELLED",
  };

  return statusMap[normalized] || normalized;
};

const applyOrderStatusSideEffects = (order, nextStatus) => {
  const now = new Date();
  order.orderStatus = nextStatus;

  if (nextStatus === "READY_TO_PICK" && !order.readyToPickAt) {
    order.readyToPickAt = now;
  }

  if (nextStatus === "IN_TRANSIT") {
    if (!order.readyToPickAt) {
      order.readyToPickAt = now;
    }

    if (!order.inTransitAt) {
      order.inTransitAt = now;
    }

    if (!order.shippedAt) {
      order.shippedAt = now;
    }

    order.outForDeliveryAt = now;
  }

  if (nextStatus === "DELIVERED") {
    if (!order.readyToPickAt) {
      order.readyToPickAt = now;
    }

    if (!order.inTransitAt) {
      order.inTransitAt = now;
    }

    if (!order.shippedAt) {
      order.shippedAt = now;
    }

    order.outForDeliveryAt = now;
    order.deliveredAt = now;
  }
};

const getShortOrderId = (order) =>
  String(order?._id || "")
    .slice(-6)
    .toUpperCase();
const getOrderNumber = (order) => order?.orderNumber || getShortOrderId(order);
const getInvoiceNumber = (order) => {
  const orderNumber = String(getOrderNumber(order) || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  return `INV-${orderNumber || getShortOrderId(order)}`;
};

const formatCurrency = (amount) => {
  const numericAmount = Number(amount || 0);
  return `Rs. ${numericAmount.toFixed(2)}`;
};

const normalizeCurrencyValue = (amount) => {
  const numericAmount = Number(amount || 0);
  return Number.isNaN(numericAmount) ? 0 : numericAmount;
};

const hasNumberValue = (value) =>
  value !== undefined && value !== null && value !== "";

const normalizePartialPaymentType = (value, fallback = "PERCENT") => {
  const normalizedValue = String(value || "")
    .trim()
    .toUpperCase();

  if (normalizedValue === "PERCENT" || normalizedValue === "FLAT") {
    return normalizedValue;
  }

  return fallback;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const addBusinessDays = (dateInput, businessDays) => {
  const date = new Date(dateInput);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  let remainingDays = businessDays;

  while (remainingDays > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();

    if (day !== 0 && day !== 6) {
      remainingDays -= 1;
    }
  }

  return date;
};

const formatShortDate = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getExpectedDeliveryText = (order) => {
  const placedAt = order?.createdAt || order?.paidAt || new Date();
  const start = addBusinessDays(placedAt, 5);
  const end = addBusinessDays(placedAt, 7);

  if (!start || !end) {
    return "Expected to deliver within 5 to 7 business days.";
  }

  return `Expected to deliver within 5 to 7 business days (${formatShortDate(start)} - ${formatShortDate(end)}).`;
};

const getOrderItemsText = (order) =>
  (order?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;
      return `${index + 1}. ${item?.name || "Product"} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}`;
    })
    .join("\n");

const getOrderItemsHtml = (order) =>
  (order?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;
      return `<li style="margin-bottom:8px;">${index + 1}. ${escapeHtml(item?.name || "Product")} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}</li>`;
    })
    .join("");

const getStoreDetails = async () => {
  const settings = await AdminInfo.findOne().lean();

  return {
    storeName: DEFAULT_STORE_DETAILS.storeName,
    email: settings?.email?.trim() || DEFAULT_STORE_DETAILS.email,
    address: settings?.address?.trim() || DEFAULT_STORE_DETAILS.address,
    gstNumber:
      settings?.gstNumber?.trim() ||
      DEFAULT_STORE_DETAILS.gstNumber ||
      DEFAULT_STORE_DETAILS.GSTNumber ||
      "",
    authorizedSignatory:
      settings?.authorizedSignatory ||
      DEFAULT_STORE_DETAILS.authorizedSignatory,
    allowCOD:
      settings?.allowCOD !== undefined
        ? Boolean(settings.allowCOD)
        : DEFAULT_STORE_DETAILS.allowCOD,
    allowPartial:
      settings?.allowPartial !== undefined
        ? Boolean(settings.allowPartial)
        : DEFAULT_STORE_DETAILS.allowPartial,
    partialPaymentType: normalizePartialPaymentType(
      settings?.partialPaymentType,
      DEFAULT_STORE_DETAILS.partialPaymentType,
    ),
    partialPaymentValue: hasNumberValue(settings?.partialPaymentValue)
      ? Number(settings.partialPaymentValue)
      : DEFAULT_STORE_DETAILS.partialPaymentValue,
    freeShippingAbove: hasNumberValue(settings?.freeShippingAbove)
      ? Number(settings.freeShippingAbove)
      : DEFAULT_STORE_DETAILS.freeShippingAbove,
    maintenanceMode:
      settings?.maintenanceMode !== undefined
        ? Boolean(settings.maintenanceMode)
        : DEFAULT_STORE_DETAILS.maintenanceMode,
  };
};

const getRemoteImageBuffer = async (url) => {
  if (!url) return null;

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
    });

    return Buffer.from(response.data);
  } catch (error) {
    return null;
  }
};

const getPlainOrderItem = (item) => {
  if (!item) return {};
  if (typeof item.toObject === "function") return item.toObject();
  if (item._doc && typeof item._doc === "object") return { ...item._doc };
  return { ...item };
};

const getOrderItemProductId = (item = {}) => {
  const product = item?.product || item?.productId;

  if (product && typeof product === "object") {
    return String(product?._id || product?.id || "").trim();
  }

  return String(product || "").trim();
};

const getProductImageUrl = (product = {}) =>
  product?.image ||
  product?.thumbnail?.url ||
  product?.images?.[0]?.url ||
  product?.guideImage?.url ||
  "";

const normalizeInvoiceItem = (item = {}, product = {}) => {
  const productFromItem =
    item?.product && typeof item.product === "object" ? item.product : {};
  const rawQuantity = Number(
    item?.quantity ??
      item?.qty ??
      item?.count ??
      item?.productQuantity ??
      productFromItem?.quantity ??
      productFromItem?.qty ??
      1,
  );
  const normalizedQuantity =
    Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  const rawLineAmount = Number(
    item?.amount ??
      item?.total ??
      item?.lineAmount ??
      item?.lineTotal ??
      item?.subtotal ??
      0,
  );
  const rawUnitPrice = Number(
    item?.price ??
      item?.unitPrice ??
      item?.sellingPrice ??
      item?.discountprice ??
      item?.discountPrice ??
      item?.finalPrice ??
      productFromItem?.price ??
      productFromItem?.unitPrice ??
      productFromItem?.sellingPrice ??
      productFromItem?.discountprice ??
      productFromItem?.discountPrice ??
      productFromItem?.finalPrice ??
      product?.discountprice ??
      product?.finalPrice ??
      product?.price ??
      0,
  );
  const resolvedPrice =
    Number.isFinite(rawUnitPrice) && rawUnitPrice > 0
      ? rawUnitPrice
      : Number.isFinite(rawLineAmount) && rawLineAmount > 0
        ? rawLineAmount / normalizedQuantity
        : 0;
  const name = String(
    item?.name ||
      item?.productName ||
      item?.productTitle ||
      item?.title ||
      productFromItem?.name ||
      productFromItem?.title ||
      product?.name ||
      product?.title ||
      "Product",
  ).trim();

  return {
    ...item,
    name: name || "Product",
    quantity: normalizedQuantity,
    price: Number.isFinite(resolvedPrice) ? resolvedPrice : 0,
    image:
      item?.image ||
      getProductImageUrl(productFromItem) ||
      getProductImageUrl(product),
    product: getOrderItemProductId(item),
    gstRate:
      item?.gstRate !== undefined && item?.gstRate !== null
        ? Number(item.gstRate || 0)
        : item?.gst !== undefined && item?.gst !== null
          ? Number(item.gst || 0)
          : Number(
              product?.gstRate ||
                productFromItem?.gstRate ||
                productFromItem?.gst ||
                product?.gst ||
                0,
            ),
    hsnCode:
      typeof item?.hsnCode === "string" && item.hsnCode.trim()
        ? item.hsnCode.trim()
        : String(product?.hsnCode || productFromItem?.hsnCode || "").trim(),
  };
};

const getInvoiceItemsWithGst = async (items = []) => {
  const normalizedItems = (Array.isArray(items) ? items : []).map(
    getPlainOrderItem,
  );
  const productIds = [
    ...new Set(normalizedItems.map(getOrderItemProductId).filter(Boolean)),
  ];

  if (!productIds.length) {
    return normalizedItems.map((item) => normalizeInvoiceItem(item));
  }

  const products = await Product.find({ _id: { $in: productIds } })
    .select(
      "_id name price finalPrice discountprice images guideImage gstRate gst hsnCode",
    )
    .lean();
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return normalizedItems.map((item) =>
    normalizeInvoiceItem(item, productById.get(getOrderItemProductId(item))),
  );
};

const getCustomerDisplayName = (customer, order) =>
  customer?.fullName ||
  order?.shippingInfo?.fullName ||
  order?.shippingInfo?.name ||
  "Customer";

const getCustomerPhone = (customer, order) =>
  customer?.phone || order?.shippingInfo?.mobile || "N/A";

const getAddressLines = (address = {}) =>
  [
    address?.fullName || address?.name,
    address?.flatNo,
    address?.area,
    address?.landmark,
    [address?.city, address?.state].filter(Boolean).join(", "),
    [address?.country, address?.pincode].filter(Boolean).join(" - "),
    address?.mobile ? `Phone: ${address.mobile}` : "",
  ].filter(Boolean);

const drawTextLines = ({
  doc,
  lines,
  x,
  y,
  width,
  lineGap = 4,
  font = "Helvetica",
  size = 10,
  color = "#3f3a37",
  boldFirstLine = false,
}) => {
  let cursorY = y;

  lines.forEach((line, index) => {
    if (!line) {
      return;
    }

    doc
      .font(boldFirstLine && index === 0 ? "Helvetica-Bold" : font)
      .fontSize(size)
      .fillColor(color)
      .text(String(line), x, cursorY, {
        width,
      });

    cursorY = doc.y + lineGap;
  });

  return cursorY;
};

const drawInvoiceTable = ({ doc, items, startX, startY, contentWidth }) => {
  const columns = [
    { label: "Sl.", width: 32, align: "left" },
    { label: "Product", width: 255, align: "left" },
    { label: "Qty", width: 40, align: "center" },
    { label: "GST %", width: 60, align: "center" },
    { label: "Amount", width: 136, align: "right" },
  ];
  const rowHeight = 36;

  doc
    .roundedRect(startX, startY, contentWidth, rowHeight, 8)
    .fillAndStroke("#f4eee9", "#d7ccc5");

  let cursorX = startX;

  columns.forEach((column) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#5a4a42")
      .text(column.label, cursorX + 8, startY + 11, {
        width: column.width - 16,
        align: column.align,
      });
    cursorX += column.width;
  });

  let cursorY = startY + rowHeight;

  items.forEach((item, index) => {
    const quantity = normalizeCurrencyValue(item?.quantity || 0);
    const price = normalizeCurrencyValue(item?.price || 0);
    const amount = quantity * price;
    const gstRate = normalizeCurrencyValue(item?.gstRate || 0);

    doc
      .rect(startX, cursorY, contentWidth, rowHeight)
      .fillAndStroke(index % 2 === 0 ? "#fffdfb" : "#fbf7f3", "#eadfd8");

    let rowX = startX;
    const values = [
      String(index + 1),
      item?.hsnCode
        ? `${item?.name || "Product"}\nHSN: ${item.hsnCode}`
        : item?.name || "Product",
      String(quantity),
      `${Number.isFinite(gstRate) ? gstRate : 0}%`,
      formatCurrency(amount),
    ];

    values.forEach((value, valueIndex) => {
      const column = columns[valueIndex];
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#2f2a27")
        .text(value, rowX + 8, cursorY + 8, {
          width: column.width - 16,
          align: column.align,
          ellipsis: true,
        });
      rowX += column.width;
    });

    cursorY += rowHeight;
  });

  return cursorY;
};

const buildInvoicePdf = async ({ order, customer, res }) => {
  const storeDetails = await getStoreDetails();
  const invoiceItems = await getInvoiceItemsWithGst(order?.orderItems || []);
  const invoiceNumber = getInvoiceNumber(order);
  const orderNumber = getOrderNumber(order);
  const customerName = getCustomerDisplayName(customer, order);
  const customerEmail = normalizeEmail(customer?.email || "");
  const customerPhone = getCustomerPhone(customer, order);
  const billingLines = [
    customerName,
    ...getAddressLines({
      ...order?.shippingInfo,
      fullName: customerName,
      mobile: customerPhone,
    }),
    customerEmail ? `Email: ${customerEmail}` : "",
  ].filter(Boolean);
  const itemTotal = invoiceItems.reduce(
    (sum, item) =>
      sum +
      normalizeCurrencyValue(item?.price) *
        normalizeCurrencyValue(item?.quantity),
    0,
  );
  const totalGstAmount = invoiceItems.reduce((sum, item) => {
    const quantity = normalizeCurrencyValue(item?.quantity || 0);
    const price = normalizeCurrencyValue(item?.price || 0);
    const gstRate = normalizeCurrencyValue(item?.gstRate || 0);
    return sum + (quantity * price * gstRate) / 100;
  }, 0);
  const totalAmount = normalizeCurrencyValue(order?.totalPrice || itemTotal);
  const shippingCharge = Number((totalAmount - itemTotal).toFixed(2));
  const paymentLabel =
    order?.paymentMode === "PARTIAL_COD"
      ? "Partial COD"
      : order?.paymentMode === "FULL"
        ? "Online Payment"
        : "Cash on Delivery";

  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${invoiceNumber}.pdf"`,
  );

  doc.pipe(res);

  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const rightX = leftX + pageWidth - 170;

  doc.roundedRect(leftX, 28, pageWidth, 110, 18).fill("#f8f3ee");

  if (fs.existsSync(INVOICE_LOGO_PATH)) {
    doc.image(INVOICE_LOGO_PATH, leftX + 18, 46, {
      fit: [118, 52],
      align: "left",
      valign: "center",
    });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#2f2a27")
    .text(storeDetails.storeName, leftX + 18, 104, {
      width: 220,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#302b28")
    .text("Tax Invoice", rightX, 48, {
      width: 170,
      align: "right",
    });

  const metaTop = 76;
  const metaLabelWidth = 72;
  const metaValueX = rightX + metaLabelWidth;
  const invoiceMeta = [
    ["Invoice No.", invoiceNumber],
    ["Order No.", orderNumber],
    ["Invoice Date", formatDateTime(order?.deliveredAt || order?.createdAt)],
    ["Payment", paymentLabel],
  ];

  invoiceMeta.forEach(([label, value], index) => {
    const rowY = metaTop + index * 16;

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#6a5f59")
      .text(label, rightX, rowY, {
        width: metaLabelWidth - 6,
      });

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#2f2a27")
      .text(value, metaValueX, rowY, {
        width: 98,
        align: "right",
      });
  });

  const sectionTop = 166;
  const boxWidth = (pageWidth - 12) / 2;

  doc
    .roundedRect(leftX, sectionTop, boxWidth, 120, 14)
    .fillAndStroke("#fffdfb", "#eadfd8");
  doc
    .roundedRect(leftX + boxWidth + 12, sectionTop, boxWidth, 120, 14)
    .fillAndStroke("#fffdfb", "#eadfd8");

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#4c4039")
    .text("Sold By", leftX + 16, sectionTop + 14);
  drawTextLines({
    doc,
    lines: [
      storeDetails.storeName,
      `GST No: ${storeDetails.gstNumber || "N/A"}`,
      storeDetails.address,
      `Email: ${storeDetails.email}`,
    ],
    x: leftX + 16,
    y: sectionTop + 34,
    width: boxWidth - 32,
    boldFirstLine: true,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#4c4039")
    .text("Billing & Shipping Address", leftX + boxWidth + 28, sectionTop + 14);
  drawTextLines({
    doc,
    lines: billingLines,
    x: leftX + boxWidth + 28,
    y: sectionTop + 34,
    width: boxWidth - 32,
    boldFirstLine: true,
  });

  let cursorY = sectionTop + 146;

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#4c4039")
    .text("Items", leftX, cursorY);

  cursorY = drawInvoiceTable({
    doc,
    items: invoiceItems,
    startX: leftX,
    startY: cursorY + 14,
    contentWidth: pageWidth,
  });

  const totalsTop = cursorY + 18;
  const totalsBoxWidth = 230;
  const totalsX = leftX + pageWidth - totalsBoxWidth;
  const gstSummary = [
    ...new Set(invoiceItems.map((item) => Number(item?.gstRate || 0))),
  ]
    .sort((a, b) => a - b)
    .map((value) => `${value}%`)
    .join(", ");

  const totals = [
    ["Items Total", formatCurrency(itemTotal)],
    ["GST Rates", gstSummary || "0%"],
    ["Estimated GST", formatCurrency(totalGstAmount)],
    ["Grand Total", formatCurrency(totalAmount)],
  ];

  doc
    .roundedRect(totalsX, totalsTop, totalsBoxWidth, 100, 14)
    .fillAndStroke("#f8f3ee", "#eadfd8");

  totals.forEach(([label, value], index) => {
    const rowY = totalsTop + 16 + index * 18;
    const isGrandTotal = index === totals.length - 1;

    doc
      .font(isGrandTotal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isGrandTotal ? 11 : 10)
      .fillColor(isGrandTotal ? "#2f2a27" : "#645955")
      .text(label, totalsX + 14, rowY, {
        width: 108,
      });

    doc
      .font(isGrandTotal ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isGrandTotal ? 11 : 10)
      .fillColor("#2f2a27")
      .text(value, totalsX + 120, rowY, {
        width: 96,
        align: "right",
      });
  });

  const notesTop = totalsTop + 120;

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#4c4039")
    .text("Notes", leftX, notesTop);

  drawTextLines({
    doc,
    lines: [
      `Order delivered on ${formatDateTime(order?.deliveredAt || order?.updatedAt)}.`,
      "This is a computer generated invoice from the Nohar app.",
      "For support, contact us using the details above.",
    ],
    x: leftX,
    y: notesTop + 18,
    width: pageWidth - totalsBoxWidth - 24,
    size: 10,
  });

  const authorizedSignatoryBuffer = await getRemoteImageBuffer(
    storeDetails.authorizedSignatory?.url,
  );

  if (authorizedSignatoryBuffer) {
    doc.image(authorizedSignatoryBuffer, totalsX + 64, notesTop - 6, {
      fit: [150, 44],
      align: "right",
      valign: "center",
    });
  } else {
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#4c4039")
      .text(storeDetails.storeName, totalsX, notesTop + 4, {
        width: totalsBoxWidth,
        align: "right",
      });
  }

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#7c7069")
    .text("Authorized Signatory", totalsX, notesTop + 42, {
      width: totalsBoxWidth,
      align: "right",
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#8e817a")
    .text("Thank you for shopping with Nohar.", leftX, 780, {
      width: pageWidth,
      align: "center",
    });

  doc.end();
};

const getMailTransporter = () => {
  if (mailTransporter) {
    return mailTransporter;
  }

  const normalizedUser = normalizeEmail(SMTP_USER);
  const normalizedPass = normalizeSmtpPass(SMTP_PASS);

  if (!normalizedUser || !normalizedPass) {
    return null;
  }

  if (normalizedUser.toLowerCase().endsWith("@gmail.com")) {
    mailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: normalizedUser,
        pass: normalizedPass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    return mailTransporter;
  }

  if (!SMTP_HOST || !SMTP_PORT) {
    return null;
  }

  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure:
      String(SMTP_SECURE).toLowerCase() === "true" || Number(SMTP_PORT) === 465,
    auth: {
      user: normalizedUser,
      pass: normalizedPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return mailTransporter;
};

const sendMail = async (mailOptions) => {
  const transporter = getMailTransporter();

  if (!transporter) {
    console.warn("[order-email] mail transporter not configured");
    return false;
  }

  return transporter.sendMail({
    from: MAIL_FROM || normalizeEmail(SMTP_USER) || ORDER_OWNER_EMAIL,
    ...mailOptions,
  });
};

const sendOrderPlacedEmails = async ({ order, customer, customerEmail }) => {
  try {
    const orderNumber = getOrderNumber(order);
    const customerName = customer?.fullName || "Customer";
    const normalizedCustomerEmail = normalizeEmail(
      customer?.email || customerEmail || "",
    );
    const orderItemsText =
      getOrderItemsText(order) || "No order items available";
    const orderItemsHtml =
      getOrderItemsHtml(order) || "<li>No order items available</li>";
    const shippingAddress = [
      order?.shippingInfo?.flatNo,
      order?.shippingInfo?.area,
      order?.shippingInfo?.landmark,
      order?.shippingInfo?.city,
      order?.shippingInfo?.state,
      order?.shippingInfo?.pincode,
      order?.shippingInfo?.country,
    ]
      .filter(Boolean)
      .join(", ");
    const expectedDeliveryText = getExpectedDeliveryText(order);

    const tasks = [];

    tasks.push(
      sendMail({
        to: ORDER_OWNER_EMAIL,
        subject: `New order placed - ${orderNumber}`,
        text: [
          "New order placed",
          `Customer name: ${customerName}`,
          `Customer phone: ${customer?.phone || order?.shippingInfo?.mobile || "N/A"}`,
          `Customer email: ${normalizedCustomerEmail || "N/A"}`,
          `Order number: ${orderNumber}`,
          `Order details:`,
          orderItemsText,
          `Shipping address: ${shippingAddress || "N/A"}`,
          `Total amount: ${formatCurrency(order?.totalPrice)}`,
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
            <h2>New order placed</h2>
            <p><strong>Customer name:</strong> ${escapeHtml(customerName)}</p>
            <p><strong>Customer phone:</strong> ${escapeHtml(customer?.phone || order?.shippingInfo?.mobile || "N/A")}</p>
            <p><strong>Customer email:</strong> ${escapeHtml(normalizedCustomerEmail || "N/A")}</p>
            <p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>
            <p><strong>Order details:</strong></p>
            <ul>${orderItemsHtml}</ul>
            <p><strong>Shipping address:</strong> ${escapeHtml(shippingAddress || "N/A")}</p>
            <p><strong>Total amount:</strong> ${formatCurrency(order?.totalPrice)}</p>
          </div>
        `,
      }).catch((error) => {
        console.error("Owner order email failed:", {
          message: error?.message,
          code: error?.code,
          command: error?.command,
        });
      }),
    );

    if (normalizedCustomerEmail) {
      tasks.push(
        sendMail({
          to: normalizedCustomerEmail,
          subject: `Thank you for placing your order - ${orderNumber}`,
          text: [
            `Thank you for placing order to Nohar Cosmetics, your order number is ${orderNumber}.`,
            "Order details:",
            orderItemsText,
            expectedDeliveryText,
          ].join("\n"),
          html: `
            <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
              <h2>Thank you for placing your order with Nohar Cosmetics</h2>
              <p>Your order number is <strong>${escapeHtml(orderNumber)}</strong>.</p>
              <p><strong>Order details:</strong></p>
              <ul>${orderItemsHtml}</ul>
              <p>${escapeHtml(expectedDeliveryText)}</p>
            </div>
          `,
        }).catch((error) => {
          console.error("Customer order email failed:", {
            message: error?.message,
            code: error?.code,
            command: error?.command,
          });
        }),
      );
    } else {
      console.warn("Customer order email skipped: user email not found");
    }

    await Promise.allSettled(tasks);
  } catch (error) {
    console.error("sendOrderPlacedEmails failed:", {
      message: error?.message,
      code: error?.code,
      command: error?.command,
    });
  }
};

const buildOrderNotificationContent = (status, order) => {
  const shortOrderId = getShortOrderId(order);

  const contentMap = {
    ORDER_PLACED: {
      title: "Order placed successfully",
      body: `Your order #${shortOrderId} has been placed successfully.`,
    },
    READY_TO_PICK: {
      title: "Order is ready to pick",
      body: `Your order #${shortOrderId} is ready to pick.`,
    },
    IN_TRANSIT: {
      title: "Order is on the way",
      body: `Your order #${shortOrderId} is now in transit.`,
    },
    DELIVERED: {
      title: "Order delivered",
      body: `Your order #${shortOrderId} has been delivered.`,
    },
    CANCELLED: {
      title: "Order cancelled",
      body: `Your order #${shortOrderId} has been cancelled.`,
    },
  };

  return (
    contentMap[status] || {
      title: "Order update",
      body: `Your order #${shortOrderId} is now ${status}.`,
    }
  );
};

const notifyOrderUser = async (userId, order, status) => {
  try {
    const user = await User.findById(userId).select("_id fcmToken");

    if (!user?.fcmToken) {
      return;
    }

    const { title, body } = buildOrderNotificationContent(status, order);

    await sendPushToUsers({
      users: [user],
      title,
      body,
      data: {
        type: "ORDER_UPDATE",
        orderId: order._id,
        orderStatus: status,
        userId,
      },
    });
  } catch (error) {
    console.error("Order notification send failed:", error.message);
  }
};

const runPostOrderTasks = ({ userId, order, customer, customerEmail }) => {
  setImmediate(async () => {
    await Promise.allSettled([notifyOrderUser(userId, order, "ORDER_PLACED")]);
  });
};

const createOrder = async (req, res) => {
  try {
    const {
      userId,
      shippingId,
      orderItems,
      totalPrice,
      paymentId,
      paymentMode,
      partialPercent,
      amountPaid,
      customerEmail,
    } = req.body;

    const normalizedPaymentMode = String(paymentMode || "")
      .trim()
      .toUpperCase();
    const normalizedCustomerEmail = String(customerEmail || "")
      .trim()
      .toLowerCase();
    const storeDetails = await getStoreDetails();

    if (
      !userId ||
      !shippingId ||
      !orderItems ||
      !totalPrice ||
      !normalizedPaymentMode
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Order items are required" });
    }

    if (storeDetails.maintenanceMode) {
      return res.status(503).json({
        success: false,
        message:
          "Orders are temporarily unavailable because maintenance mode is enabled",
      });
    }

    if (
      !storeDetails.allowCOD &&
      (normalizedPaymentMode === "COD" ||
        normalizedPaymentMode === "PARTIAL_COD")
    ) {
      return res.status(400).json({
        success: false,
        message: "Cash on delivery is currently disabled",
      });
    }

    const normalizedTotal = normalizeNumber(totalPrice);

    if (!normalizedTotal || normalizedTotal <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid total price" });
    }

    const requiresOnlinePayment =
      normalizedPaymentMode === "FULL" ||
      normalizedPaymentMode === "PARTIAL_COD";

    if (requiresOnlinePayment && !paymentId) {
      return res
        .status(400)
        .json({ success: false, message: "Payment ID is required" });
    }

    if (normalizedPaymentMode === "PARTIAL_COD" && !storeDetails.allowPartial) {
      return res.status(400).json({
        success: false,
        message: "Partial payment is currently disabled",
      });
    }

    const customer = await User.findById(userId).select(
      "_id fullName email phone fcmToken",
    );

    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const shippingInfo = await ShippingInfo.findById(shippingId);

    if (!shippingInfo) {
      return res
        .status(404)
        .json({ success: false, message: "Shipping address not found" });
    }

    const selectedAddress =
      shippingInfo.addresses.find((add) => add.isDefault) ||
      shippingInfo.addresses[0];

    if (!selectedAddress) {
      return res
        .status(400)
        .json({ success: false, message: "No valid shipping info found" });
    }

    let normalizedPercent = 0;
    let normalizedAmountPaid = 0;
    let normalizedAmountDue = 0;
    let paymentStatus = "PENDING";
    let remainingPaymentMethod = "COD";

    let normalizedPaymentId = paymentId;
    let paidAt = Date.now();

    if (normalizedPaymentMode === "FULL") {
      normalizedPercent = 100;
      normalizedAmountPaid = normalizedTotal;
      normalizedAmountDue = 0;
      paymentStatus = "PAID";
      remainingPaymentMethod = undefined;
    } else if (normalizedPaymentMode === "PARTIAL_COD") {
      const configuredPartialType = normalizePartialPaymentType(
        storeDetails.partialPaymentType,
        "PERCENT",
      );
      const configuredPartialValue = normalizeNumber(
        storeDetails.partialPaymentValue,
      );

      if (configuredPartialType === "FLAT") {
        if (
          configuredPartialValue === null ||
          configuredPartialValue <= 0 ||
          configuredPartialValue >= normalizedTotal
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Partial flat amount must be greater than 0 and less than total price",
          });
        }

        normalizedAmountPaid = Number(configuredPartialValue.toFixed(2));
        normalizedPercent = Number(
          ((normalizedAmountPaid / normalizedTotal) * 100).toFixed(2),
        );
      } else {
        const percentValue =
          configuredPartialValue ?? normalizeNumber(partialPercent ?? 20);

        if (!percentValue || percentValue <= 0 || percentValue >= 100) {
          return res.status(400).json({
            success: false,
            message: "Partial percent must be between 1 and 99",
          });
        }

        normalizedPercent = percentValue;
        normalizedAmountPaid = Number(
          ((normalizedTotal * percentValue) / 100).toFixed(2),
        );
      }

      if (amountPaid !== undefined && normalizeNumber(amountPaid) !== null) {
        normalizedAmountPaid = Number(normalizedAmountPaid.toFixed(2));
      }

      normalizedAmountDue = Number(
        (normalizedTotal - normalizedAmountPaid).toFixed(2),
      );
      paymentStatus = "PARTIALLY_PAID";
    } else if (normalizedPaymentMode === "COD") {
      normalizedPercent = 0;
      normalizedAmountPaid = 0;
      normalizedAmountDue = normalizedTotal;
      paymentStatus = "PENDING";
      remainingPaymentMethod = "COD";
      normalizedPaymentId = undefined;
      paidAt = undefined;
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment mode" });
    }

    if (normalizedAmountPaid < 0 || normalizedAmountPaid > normalizedTotal) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid paid amount" });
    }

    const productIds = [
      ...new Set(
        orderItems
          .map((item) => String(item?.product || item?.productId || "").trim())
          .filter(Boolean),
      ),
    ];
    const orderedProducts = await Product.find({ _id: { $in: productIds } })
      .select(
        "_id name price finalPrice discountprice images guideImage gstRate gst hsnCode",
      )
      .lean();
    const productById = new Map(
      orderedProducts.map((product) => [String(product._id), product]),
    );
    const normalizedOrderItems = orderItems.map((item) => {
      const productId = String(item?.product || item?.productId || "").trim();
      const productMeta = productById.get(productId) || {};

      return normalizeInvoiceItem(
        {
          ...item,
          product: productId,
        },
        productMeta,
      );
    });

    const order = new Order({
      user: userId,
      shippingInfo: selectedAddress,
      orderItems: normalizedOrderItems,
      totalPrice: normalizedTotal,
      orderStatus: "ORDER_PLACED",
      payment: normalizedPaymentId,
      paymentMode: normalizedPaymentMode,
      paymentStatus,
      partialPercent: normalizedPercent,
      amountPaid: normalizedAmountPaid,
      amountDue: normalizedAmountDue,
      remainingPaymentMethod,
    });

    if (paidAt) {
      order.paidAt = paidAt;
    }

    await order.save();

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });

    runPostOrderTasks({
      userId,
      order,
      customer,
      customerEmail: normalizedCustomerEmail || customer?.email,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Order ID format",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (normalizeOrderStatus(order.orderStatus) === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Order is already cancelled",
      });
    }

    order.orderStatus = "CANCELLED";
    await order.save();
    await notifyOrderUser(order.user, order, "CANCELLED");

    res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("user", "_id fullName email phone")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAdminOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId).populate(
      "user",
      "_id fullName email phone",
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getUserOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    const orders = await Order.find({ user: userId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const downloadOrderInvoice = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId).populate(
      "user",
      "_id fullName email phone",
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (String(order.user?._id) !== String(req.user?._id)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this invoice",
      });
    }

    if (normalizeOrderStatus(order.orderStatus) !== "DELIVERED") {
      return res.status(400).json({
        success: false,
        message: "Invoice is available only after the order is delivered",
      });
    }

    await buildInvoicePdf({
      order,
      customer: order.user,
      res,
    });
  } catch (error) {
    console.error("downloadOrderInvoice failed:", {
      message: error?.message,
    });

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate invoice",
      });
    }

    return res.end();
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, cancellationReason } = req.body;

    const normalizedStatus = normalizeOrderStatus(status);
    const validStatuses = [...ORDER_PHASES, "CANCELLED"];

    if (!validStatuses.includes(normalizedStatus)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order status" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (normalizedStatus === "CANCELLED") {
      const normalizedReason = String(cancellationReason || "").trim();

      if (!normalizedReason) {
        return res.status(400).json({
          success: false,
          message: "Cancellation reason is required",
        });
      }

      order.orderStatus = "CANCELLED";
      order.cancellationReason = normalizedReason;
      order.cancelledAt = new Date();
      order.cancelledBy = "ADMIN";
    } else {
      order.cancellationReason = null;
      order.cancelledAt = null;
      order.cancelledBy = null;
      applyOrderStatusSideEffects(order, normalizedStatus);
    }

    await order.save();
    await notifyOrderUser(order.user, order, normalizedStatus);
    const populatedOrder = await Order.findById(order._id).populate(
      "user",
      "_id fullName email phone",
    );

    res
      .status(200)
      .json({
        success: true,
        message: "Order status updated",
        order: populatedOrder,
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message,
    });
  }
};

const advanceOrderPhase = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const currentStatus = normalizeOrderStatus(order.orderStatus);

    if (currentStatus === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Cancelled orders cannot be advanced",
      });
    }

    const currentIndex = ORDER_PHASES.indexOf(currentStatus);

    if (currentIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "Order is in an unknown status and cannot be advanced",
      });
    }

    if (currentIndex >= ORDER_PHASES.length - 1) {
      return res.status(400).json({
        success: false,
        message: "Order is already in the final phase",
      });
    }

    const nextStatus = ORDER_PHASES[currentIndex + 1];

    applyOrderStatusSideEffects(order, nextStatus);
    await order.save();
    await notifyOrderUser(order.user, order, nextStatus);

    return res.status(200).json({
      success: true,
      message: `Order moved to ${nextStatus}`,
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message,
    });
  }
};

module.exports = {
  createOrder,
  cancelOrder,
  getOrders,
  getAdminOrderDetails,
  getUserOrders,
  downloadOrderInvoice,
  updateOrderStatus,
  advanceOrderPhase,
};
