const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      unique: true,
      required: true,
      index: true,
      trim: true,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
      index: true,
    },
    providerRequestId: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "verified", "expired"],
      default: "pending",
    },
    firstSentAt: {
      type: Date,
      default: null,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    resendCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    sendCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verifyAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastVerifyAt: {
      type: Date,
      default: null,
    },
    failureReason: {
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
    lastProviderResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

const Otp = mongoose.model("Otp", otpSchema);

module.exports = Otp;
