const mongoose = require("mongoose");

const otpBlockedIpSchema = new mongoose.Schema(
  {
    ipAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
    isBlocked: {
      type: Boolean,
      default: true,
      index: true,
    },
    blockedBy: {
      type: String,
      default: null,
      trim: true,
    },
    blockedByEmail: {
      type: String,
      default: null,
      trim: true,
    },
    blockedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unblockedAt: {
      type: Date,
      default: null,
    },
    matchCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastMatchedAt: {
      type: Date,
      default: null,
    },
    source: {
      type: String,
      default: "unknown",
      trim: true,
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
  },
  { timestamps: true },
);

otpBlockedIpSchema.index({ isBlocked: 1, ipAddress: 1 });

const OtpBlockedIp = mongoose.model("OtpBlockedIp", otpBlockedIpSchema);

module.exports = OtpBlockedIp;
