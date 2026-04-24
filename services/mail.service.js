const dns = require("dns").promises;
const nodemailer = require("nodemailer");
const {
  MAIL_FROM,
  ORDER_OWNER_EMAIL,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
} = require("../config/config");

let transporter;
let transporterVerified = false;
let diagnosticsLogged = false;

const formatCurrency = (amount) => {
  const numericAmount = Number(amount || 0);
  return `Rs. ${numericAmount.toFixed(2)}`;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeEmail = (value) => String(value || "").trim();
const normalizeSmtpPass = (value) => String(value || "").replace(/\s+/g, "").trim();

const getMaskedEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail.includes("@")) {
    return normalizedEmail || "not-set";
  }

  const [userName, domain] = normalizedEmail.split("@");
  const visiblePart = userName.slice(0, 2) || "**";
  return `${visiblePart}***@${domain}`;
};

const getTransportSummary = () => ({
  host: normalizeEmail(SMTP_HOST) || "not-set",
  port: Number(SMTP_PORT) || "not-set",
  secure:
    String(SMTP_SECURE).toLowerCase() === "true" || Number(SMTP_PORT) === 465,
  user: getMaskedEmail(SMTP_USER),
  passLength: normalizeSmtpPass(SMTP_PASS).length,
  usingGmailService: normalizeEmail(SMTP_USER).toLowerCase().endsWith("@gmail.com"),
});

const logMailDiagnostics = async () => {
  if (diagnosticsLogged) {
    return;
  }

  diagnosticsLogged = true;

  const summary = getTransportSummary();
  console.log("[mail] transport summary:", summary);

  if (summary.host !== "not-set") {
    try {
      const lookupResult = await dns.lookup(summary.host, { all: true });
      console.log("[mail] dns lookup:", lookupResult);
    } catch (error) {
      console.error("[mail] dns lookup failed:", {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
      });
    }
  }
};

const logMailErrorDetails = (label, error) => {
  console.error(`[mail] ${label}:`, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    command: error?.command,
    response: error?.response,
    responseCode: error?.responseCode,
    stack: error?.stack?.split("\n")?.slice(0, 3)?.join(" | "),
  });
};

const getCustomerName = (user, order) =>
  user?.fullName || order?.shippingInfo?.fullName || "Customer";

const getOrderNumber = (order) =>
  order?.orderNumber || String(order?._id || "").slice(-9).toUpperCase();

const buildAddressLine = (order) => {
  const address = order?.shippingInfo || {};
  return [
    address.flatNo,
    address.area,
    address.landmark,
    address.city,
    address.state,
    address.pincode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
};

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

const getExpectedDeliveryText = (order) => {
  const placedAt = order?.createdAt || order?.paidAt || new Date();
  const start = addBusinessDays(placedAt, 5);
  const end = addBusinessDays(placedAt, 7);

  if (!start || !end) {
    return "Expected to deliver within 5 to 7 business days.";
  }

  return `Expected to deliver within 5 to 7 business days (${formatShortDate(start)} - ${formatShortDate(end)}).`;
};

const createTransporter = () => {
  const normalizedUser = normalizeEmail(SMTP_USER);
  const normalizedPass = normalizeSmtpPass(SMTP_PASS);

  if (!normalizedUser || !normalizedPass) {
    return null;
  }

  const commonOptions = {
    auth: {
      user: normalizedUser,
      pass: normalizedPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: true,
    debug: true,
  };

  if (normalizedUser.toLowerCase().endsWith("@gmail.com")) {
    return nodemailer.createTransport({
      service: "gmail",
      ...commonOptions,
    });
  }

  if (!SMTP_HOST || !SMTP_PORT) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure:
      String(SMTP_SECURE).toLowerCase() === "true" || Number(SMTP_PORT) === 465,
    ...commonOptions,
  });
};

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = createTransporter();
  return transporter;
};

const verifyTransporterOnce = async () => {
  if (transporterVerified) {
    return true;
  }

  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    console.warn("[mail] transporter missing during verify");
    return false;
  }

  await logMailDiagnostics();

  try {
    await activeTransporter.verify();
    transporterVerified = true;
    console.log("[mail] transporter verify successful");
    return true;
  } catch (error) {
    logMailErrorDetails("transporter verify failed", error);
    throw error;
  }
};

const sendMailSafely = async (mailOptions) => {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    console.warn("Mail transporter is not configured. Skipping order email.");
    return false;
  }

  await verifyTransporterOnce();

  await activeTransporter.sendMail({
    from: MAIL_FROM || normalizeEmail(SMTP_USER) || ORDER_OWNER_EMAIL,
    ...mailOptions,
  });

  return true;
};

const buildOrderItemsText = (order) =>
  (order?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;
      return `${index + 1}. ${item?.name || "Product"} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}`;
    })
    .join("\n");

const buildOrderItemsHtml = (order) =>
  (order?.orderItems || [])
    .map((item, index) => {
      const quantity = Number(item?.quantity || 0);
      const price = Number(item?.price || 0);
      const total = quantity * price;

      return `<li style="margin-bottom:8px;">${index + 1}. ${escapeHtml(item?.name || "Product")} | Qty: ${quantity} | Price: ${formatCurrency(price)} | Total: ${formatCurrency(total)}</li>`;
    })
    .join("");

const sendOrderPlacedEmails = async ({ order, user, customerEmail }) => {
  const customerName = getCustomerName(user, order);
  const normalizedCustomerEmail = normalizeEmail(customerEmail || user?.email || "");
  const orderNumber = getOrderNumber(order);
  const orderItemsText = buildOrderItemsText(order) || "No order items available";
  const orderItemsHtml = buildOrderItemsHtml(order) || "<li>No order items available</li>";
  const addressLine = buildAddressLine(order) || "Address not available";
  const expectedDeliveryText = getExpectedDeliveryText(order);

  const ownerMailPromise = sendMailSafely({
    to: ORDER_OWNER_EMAIL,
    subject: `New order placed - ${orderNumber}`,
    text: [
      "New order placed",
      `Customer name: ${customerName}`,
      `Customer phone: ${user?.phone || order?.shippingInfo?.mobile || "N/A"}`,
      `Customer email: ${normalizedCustomerEmail || "N/A"}`,
      `Order number: ${orderNumber}`,
      `Payment type: ${order?.paymentMode || "N/A"}`,
      `Total amount: ${formatCurrency(order?.totalPrice)}`,
      `Shipping address: ${addressLine}`,
      "Order details:",
      orderItemsText,
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#222;line-height:1.6;">
        <h2 style="margin-bottom:16px;">New order placed</h2>
        <p><strong>Customer name:</strong> ${escapeHtml(customerName)}</p>
        <p><strong>Customer phone:</strong> ${escapeHtml(user?.phone || order?.shippingInfo?.mobile || "N/A")}</p>
        <p><strong>Customer email:</strong> ${escapeHtml(normalizedCustomerEmail || "N/A")}</p>
        <p><strong>Order number:</strong> ${escapeHtml(orderNumber)}</p>
        <p><strong>Payment type:</strong> ${escapeHtml(order?.paymentMode || "N/A")}</p>
        <p><strong>Total amount:</strong> ${formatCurrency(order?.totalPrice)}</p>
        <p><strong>Shipping address:</strong> ${escapeHtml(addressLine)}</p>
        <p><strong>Order details:</strong></p>
        <ul style="padding-left:18px;">${orderItemsHtml}</ul>
      </div>
    `,
  }).catch((error) => {
    logMailErrorDetails("owner order email failed", error);
  });

  const customerMailPromise = normalizedCustomerEmail
    ? sendMailSafely({
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
            <h2 style="margin-bottom:16px;">Thank you for placing your order with Nohar Cosmetics</h2>
            <p>Your order number is <strong>${escapeHtml(orderNumber)}</strong>.</p>
            <p><strong>Order details:</strong></p>
            <ul style="padding-left:18px;">${orderItemsHtml}</ul>
            <p>${escapeHtml(expectedDeliveryText)}</p>
          </div>
        `,
      }).catch((error) => {
        logMailErrorDetails("customer order email failed", error);
      })
    : Promise.resolve();

  await Promise.allSettled([ownerMailPromise, customerMailPromise]);
};

const runMailDiagnostics = async () => {
  try {
    await verifyTransporterOnce();
    console.log("[mail] diagnostics completed successfully");
  } catch (error) {
    logMailErrorDetails("mail diagnostics failed", error);
    throw error;
  }
};

module.exports = {
  runMailDiagnostics,
  sendOrderPlacedEmails,
};
