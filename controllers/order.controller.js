const nodemailer = require("nodemailer");
const Order = require("../models/order.model");
const ShippingInfo = require("../models/shippingInfo.model");
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

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? null : numericValue;
};

const normalizeEmail = (value) => String(value || "").trim();
const normalizeSmtpPass = (value) => String(value || "").replace(/\s+/g, "").trim();

const ORDER_PHASES = [
  "ORDER_PLACED",
  "READY_TO_PICK",
  "IN_TRANSIT",
  "DELIVERED",
];

const normalizeOrderStatus = (status) => {
  const normalized = String(status || "").trim().toUpperCase();

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

const getShortOrderId = (order) => String(order?._id || "").slice(-6).toUpperCase();
const getOrderNumber = (order) => order?.orderNumber || getShortOrderId(order);

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

const sendOrderEmailSms = async ({ order, customer, customerEmail }) => {
  try {
    const orderNumber = getOrderNumber(order);
    const customerName = customer?.fullName || "Customer";
    const normalizedCustomerEmail = normalizeEmail(customerEmail || customer?.email || "");
    const orderItemsText = getOrderItemsText(order) || "No order items available";
    const orderItemsHtml = getOrderItemsHtml(order) || "<li>No order items available</li>";
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
    console.error("sendOrderEmailSms failed:", {
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
    await Promise.allSettled([
      notifyOrderUser(userId, order, "ORDER_PLACED"),
      sendOrderEmailSms({
        order,
        customer,
        customerEmail,
      }),
    ]);
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

    const normalizedPaymentMode = String(paymentMode || "").trim().toUpperCase();
    const normalizedCustomerEmail = String(customerEmail || "").trim().toLowerCase();

    if (!userId || !shippingId || !orderItems || !totalPrice || !normalizedPaymentMode) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Order items are required" });
    }

    const normalizedTotal = normalizeNumber(totalPrice);

    if (!normalizedTotal || normalizedTotal <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid total price" });
    }

    const requiresOnlinePayment =
      normalizedPaymentMode === "FULL" || normalizedPaymentMode === "PARTIAL_COD";

    if (requiresOnlinePayment && !paymentId) {
      return res
        .status(400)
        .json({ success: false, message: "Payment ID is required" });
    }

    const customer = await User.findById(userId).select("_id fullName email phone fcmToken");

    if (!customer) {
      return res.status(404).json({ success: false, message: "User not found" });
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
      const percentValue = normalizeNumber(partialPercent ?? 20);

      if (!percentValue || percentValue <= 0 || percentValue >= 100) {
        return res.status(400).json({
          success: false,
          message: "Partial percent must be between 1 and 99",
        });
      }

      normalizedPercent = percentValue;
      normalizedAmountPaid =
        normalizeNumber(amountPaid) ??
        Number((normalizedTotal * percentValue) / 100);
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

    const order = new Order({
      user: userId,
      shippingInfo: selectedAddress,
      orderItems,
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
    const orders = await Order.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

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

    applyOrderStatusSideEffects(order, normalizedStatus);

    await order.save();
    await notifyOrderUser(order.user, order, normalizedStatus);

    res
      .status(200)
      .json({ success: true, message: "Order status updated", order });
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
  getUserOrders,
  updateOrderStatus,
  advanceOrderPhase,
};
