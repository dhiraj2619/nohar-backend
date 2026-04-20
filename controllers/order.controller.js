const Order = require("../models/order.model");
const ShippingInfo = require("../models/shippingInfo.model");
const User = require("../models/users.model");
const { sendPushToUsers } = require("../services/notification.service");

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? null : numericValue;
};

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
    } = req.body;

    if (!userId || !shippingId || !orderItems || !totalPrice || !paymentMode) {
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

    if (!paymentId) {
      return res
        .status(400)
        .json({ success: false, message: "Payment ID is required" });
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

    if (paymentMode === "FULL") {
      normalizedPercent = 100;
      normalizedAmountPaid = normalizedTotal;
      normalizedAmountDue = 0;
      paymentStatus = "PAID";
      remainingPaymentMethod = undefined;
    } else if (paymentMode === "PARTIAL_COD") {
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
      paidAt: Date.now(),
      orderStatus: "ORDER_PLACED",
      payment: paymentId,
      paymentMode,
      paymentStatus,
      partialPercent: normalizedPercent,
      amountPaid: normalizedAmountPaid,
      amountDue: normalizedAmountDue,
      remainingPaymentMethod,
    });

    await order.save();
    await notifyOrderUser(userId, order, "ORDER_PLACED");

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
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
