const mongoose = require("mongoose");

const REFERRAL_SOURCES = ["SHRISAMARTH"];

const referralVisitSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: REFERRAL_SOURCES,
      required: true,
      index: true,
    },
    visitorId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    landingPath: {
      type: String,
      default: "",
      trim: true,
    },
    referrer: {
      type: String,
      default: "",
      trim: true,
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

referralVisitSchema.index({ source: 1, createdAt: -1 });

const ReferralVisit = mongoose.model("ReferralVisit", referralVisitSchema);

module.exports = ReferralVisit;
module.exports.REFERRAL_SOURCES = REFERRAL_SOURCES;
