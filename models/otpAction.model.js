const mongoose = require("mongoose");

const otpActionSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    actionType: {
      type: String,
      enum: ["send", "resend", "verify"],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["app", "website", "unknown"],
      default: "unknown",
      index: true,
    },
    sourceRaw: {
      type: String,
      default: null,
      trim: true,
    },
    sourceUserAgent: {
      type: String,
      default: null,
      trim: true,
    },
    sourceIpAddress: {
      type: String,
      default: null,
      trim: true,
    },
    traceId: {
      type: String,
      default: null,
      index: true,
      trim: true,
    },
    providerRequestId: {
      type: String,
      default: null,
      trim: true,
    },
    providerStatusCode: {
      type: Number,
      default: null,
    },
    deliveryStatus: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      default: null,
      trim: true,
    },
    failureReason: {
      type: String,
      default: null,
      trim: true,
    },
    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

const OtpAction = mongoose.model("OtpAction", otpActionSchema);

module.exports = OtpAction;
