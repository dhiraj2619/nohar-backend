const Order = require("../models/order.model");
const ShippingInfo = require("../models/shippingInfo.model");

const normalizeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? null : numericValue;
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
      orderStatus: "Processing",
      payment: paymentId,
      paymentMode,
      paymentStatus,
      partialPercent: normalizedPercent,
      amountPaid: normalizedAmountPaid,
      amountDue: normalizedAmountDue,
      remainingPaymentMethod,
    });

    await order.save();

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

    if (order.orderStatus === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "Order is already cancelled",
      });
    }

    order.orderStatus = "Cancelled";
    await order.save();

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

    const validStatuses = [
      "Processing",
      "Shipped",
      "Out for Delivery",
      "Delivered",
      "Cancelled",
    ];

    if (!validStatuses.includes(status)) {
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

    order.orderStatus = status;

    if (status === "Shipped") {
      order.shippedAt = new Date();
    }

    if (status === "Out for Delivery") {
      order.outForDeliveryAt = new Date();
    }

    if (status === "Delivered") {
      order.deliveredAt = new Date();
    }

    await order.save();

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

module.exports = {
  createOrder,
  cancelOrder,
  getOrders,
  getUserOrders,
  updateOrderStatus,
};
