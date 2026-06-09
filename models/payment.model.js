const mongoose = require("mongoose");

const PaymentModelSchema = new mongoose.Schema(
  {
    razorpay_order_id: {
      type: String,
      required: true,
      index: true,
    },
    razorpay_payment_id: {
      type: String,
      default: "",
    },
    razorpay_signature: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    receipt: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["CREATED", "SUCCESS", "FAILED"],
      default: "CREATED",
      index: true,
    },
    source: {
      type: String,
      enum: ["website", "app", "unknown"],
      default: "unknown",
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      default: null,
    },
    order: {
      type: mongoose.Schema.ObjectId,
      ref: "Order",
      default: null,
    },
    failureReason: {
      type: String,
      default: "",
    },
    failureCode: {
      type: String,
      default: "",
    },
    failureDescription: {
      type: String,
      default: "",
    },
    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

const Payment = mongoose.model("payment", PaymentModelSchema);

module.exports = Payment;
