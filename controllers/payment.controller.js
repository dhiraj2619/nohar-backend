const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/payment.model");

const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_SECRET) {
    return null;
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_SECRET,
  });
};

const normalizeSource = (source) => {
  const normalizedSource = String(source || "").trim().toLowerCase();

  if (normalizedSource === "website") return "website";
  if (normalizedSource === "app") return "app";

  return "unknown";
};

const normalizeUserId = (userId) =>
  mongoose.Types.ObjectId.isValid(userId) ? userId : null;

const createOrder = async (req, res) => {
  const { amount, source, bookingSource, userId } = req.body;

  try {
    const razorpayInstance = getRazorpayInstance();

    if (!razorpayInstance) {
      return res.status(500).json({
        success: false,
        message: "Razorpay keys are not configured",
      });
    }

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    const options = {
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      receipt: crypto.randomBytes(10).toString("hex"),
    };

    const order = await razorpayInstance.orders.create(options);

    await Payment.findOneAndUpdate(
      { razorpay_order_id: order.id },
      {
        $set: {
          razorpay_order_id: order.id,
          amount: Number(order.amount || options.amount) / 100,
          currency: order.currency || options.currency,
          receipt: order.receipt || options.receipt,
          status: "CREATED",
          source: normalizeSource(source || bookingSource),
          user: normalizeUserId(userId),
          rawResponse: order,
          date: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(201).json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      data: order,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create order",
    });
  }
};

const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, source } =
    req.body;

  try {
    if (!process.env.RAZORPAY_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Razorpay secret is not configured",
      });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing payment verification fields",
      });
    }

    const sign = `${razorpay_order_id}|${razorpay_payment_id}`;

    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(sign)
      .digest("hex");

    const isAuthentic = expectedSign === razorpay_signature;

    if (!isAuthentic) {
      await Payment.findOneAndUpdate(
        { razorpay_order_id },
        {
          $set: {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            status: "FAILED",
            source: normalizeSource(source),
            failureReason: "Invalid payment signature",
            failureCode: "INVALID_SIGNATURE",
            failedAt: new Date(),
            rawResponse: req.body,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    const payment = await Payment.findOneAndUpdate(
      { razorpay_order_id },
      {
        $set: {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          status: "SUCCESS",
          source: normalizeSource(source),
          failureReason: "",
          failureCode: "",
          failureDescription: "",
          verifiedAt: new Date(),
          rawResponse: req.body,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Payment successfully verified",
      payment,
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error!",
    });
  }
};

const markPaymentFailed = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      order_id,
      error,
      reason,
      code,
      description,
      source,
    } = req.body;
    const razorpayOrderId =
      razorpay_order_id || order_id || error?.metadata?.order_id || "";

    if (!razorpayOrderId) {
      return res.status(400).json({
        success: false,
        message: "Razorpay order id is required",
      });
    }

    const payment = await Payment.findOneAndUpdate(
      { razorpay_order_id: razorpayOrderId },
      {
        $set: {
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: error?.metadata?.payment_id || "",
          status: "FAILED",
          source: normalizeSource(source),
          failureReason: reason || error?.reason || error?.source || "Payment failed",
          failureCode: code || error?.code || "",
          failureDescription: description || error?.description || "",
          failedAt: new Date(),
          rawResponse: req.body,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Payment failure recorded",
      payment,
    });
  } catch (error) {
    console.error("Payment failure track error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to record payment failure",
    });
  }
};

const getPayments = async (req, res) => {
  try {
    const { status, source, search } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = String(status).trim().toUpperCase();
    }

    if (source && source !== "all") {
      filter.source = normalizeSource(source);
    }

    if (search && String(search).trim()) {
      const pattern = String(search).trim();
      filter.$or = [
        { razorpay_order_id: { $regex: pattern, $options: "i" } },
        { razorpay_payment_id: { $regex: pattern, $options: "i" } },
        { receipt: { $regex: pattern, $options: "i" } },
        { failureReason: { $regex: pattern, $options: "i" } },
        { failureCode: { $regex: pattern, $options: "i" } },
      ];
    }

    const payments = await Payment.find(filter)
      .populate("user", "fullName phone email")
      .populate("order", "orderNumber totalPrice orderStatus paymentStatus")
      .sort({ createdAt: -1 })
      .limit(500);

    return res.status(200).json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Get payments error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
    });
  }
};

const parseSyncDate = (value, fallbackDate) => {
  if (!value) return fallbackDate;

  const parsedDate = new Date(value);

  return Number.isNaN(parsedDate.getTime()) ? fallbackDate : parsedDate;
};

const mapRazorpayPaymentStatus = (status) => {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "captured") return "SUCCESS";
  if (normalizedStatus === "failed") return "FAILED";

  return "CREATED";
};

const syncRazorpayPayments = async (req, res) => {
  try {
    const razorpayInstance = getRazorpayInstance();

    if (!razorpayInstance) {
      return res.status(500).json({
        success: false,
        message: "Razorpay keys are not configured",
      });
    }

    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), 0, 1);
    const fromDate = parseSyncDate(req.body?.from || req.query?.from, defaultFrom);
    const toDate = parseSyncDate(req.body?.to || req.query?.to, now);
    const maxPages = Math.min(
      Math.max(Number(req.body?.maxPages || req.query?.maxPages || 20), 1),
      50,
    );
    const pageSize = 100;

    let skip = 0;
    let imported = 0;
    let updated = 0;
    let scanned = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await razorpayInstance.payments.all({
        from: Math.floor(fromDate.getTime() / 1000),
        to: Math.floor(toDate.getTime() / 1000),
        count: pageSize,
        skip,
      });
      const items = Array.isArray(response?.items) ? response.items : [];

      if (!items.length) break;

      for (const item of items) {
        scanned += 1;

        const razorpayOrderId = item.order_id || `payment_only_${item.id}`;
        const status = mapRazorpayPaymentStatus(item.status);
        const existingPayment = await Payment.findOne({
          $or: [
            { razorpay_payment_id: item.id },
            { razorpay_order_id: razorpayOrderId },
          ],
        }).select("_id");

        await Payment.findOneAndUpdate(
          existingPayment
            ? { _id: existingPayment._id }
            : { razorpay_payment_id: item.id },
          {
            $set: {
              razorpay_order_id: razorpayOrderId,
              razorpay_payment_id: item.id,
              amount: Number(item.amount || 0) / 100,
              currency: item.currency || "INR",
              receipt: item.notes?.receipt || item.receipt || "",
              status,
              source: "unknown",
              failureReason: status === "FAILED" ? item.error_reason || "" : "",
              failureCode: status === "FAILED" ? item.error_code || "" : "",
              failureDescription:
                status === "FAILED" ? item.error_description || "" : "",
              verifiedAt:
                status === "SUCCESS"
                  ? new Date((item.created_at || Date.now() / 1000) * 1000)
                  : null,
              failedAt:
                status === "FAILED"
                  ? new Date((item.created_at || Date.now() / 1000) * 1000)
                  : null,
              rawResponse: item,
              date: new Date((item.created_at || Date.now() / 1000) * 1000),
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        );

        if (existingPayment) updated += 1;
        else imported += 1;
      }

      if (items.length < pageSize) break;
      skip += pageSize;
    }

    return res.status(200).json({
      success: true,
      message: "Razorpay payments synced",
      scanned,
      imported,
      updated,
      from: fromDate,
      to: toDate,
    });
  } catch (error) {
    console.error("Razorpay payment sync error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync Razorpay payments",
    });
  }
};

module.exports = {
  createOrder,
  getPayments,
  markPaymentFailed,
  syncRazorpayPayments,
  verifyPayment,
};
