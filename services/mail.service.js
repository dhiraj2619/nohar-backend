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

const transporters = new Map();

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

const getTransportOptionsList = () => {
  const normalizedHost = normalizeEmail(SMTP_HOST);
  const normalizedPort = Number(SMTP_PORT);
  const normalizedUser = normalizeEmail(SMTP_USER);
  const normalizedPass = normalizeSmtpPass(SMTP_PASS);

  if (!normalizedHost || !normalizedPort || !normalizedUser || !normalizedPass) {
    return [];
  }

  const configuredSecure =
    String(SMTP_SECURE).toLowerCase() === "true" || normalizedPort === 465;

  const primaryTransport = {
    id: `primary:${normalizedHost}:${normalizedPort}:${configuredSecure}`,
    host: normalizedHost,
    port: normalizedPort,
    secure: configuredSecure,
    auth: {
      user: normalizedUser,
      pass: normalizedPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    family: 4,
  };

  const gmailFallbacks =
    normalizedHost === "smtp.gmail.com"
      ? [
          {
            id: "gmail:465:true",
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
              user: normalizedUser,
              pass: normalizedPass,
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
            family: 4,
          },
          {
            id: "gmail:587:false",
            host: "smtp.gmail.com",
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
              user: normalizedUser,
              pass: normalizedPass,
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000,
            family: 4,
          },
        ]
      : [];

  return [primaryTransport, ...gmailFallbacks].filter(
    (option, index, list) =>
      list.findIndex((candidate) => candidate.id === option.id) === index,
  );
};

const getTransporter = (transportOptions) => {
  if (transporters.has(transportOptions.id)) {
    return transporters.get(transportOptions.id);
  }

  const transporter = nodemailer.createTransport(transportOptions);
  transporters.set(transportOptions.id, transporter);
  return transporter;
};

const sendMailSafely = async (mailOptions) => {
  const transportOptionsList = getTransportOptionsList();

  if (!transportOptionsList.length) {
    console.warn("Mail transporter is not configured. Skipping order email.");
    return false;
  }

  let lastError;

  for (const transportOptions of transportOptionsList) {
    try {
      const activeTransporter = getTransporter(transportOptions);
      await activeTransporter.sendMail({
        from: MAIL_FROM || normalizeEmail(SMTP_USER) || ORDER_OWNER_EMAIL,
        ...mailOptions,
      });
      return true;
    } catch (error) {
      lastError = error;
      console.error(
        `Mail send failed via ${transportOptions.host}:${transportOptions.port} secure=${transportOptions.secure}:`,
        error.message,
      );
    }
  }

  throw lastError;
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
    console.error("Owner order email failed:", error.message);
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
        console.error("Customer order email failed:", error.message);
      })
    : Promise.resolve();

  await Promise.allSettled([ownerMailPromise, customerMailPromise]);
};

module.exports = {
  sendOrderPlacedEmails,
};
