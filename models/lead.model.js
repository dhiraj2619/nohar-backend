const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    leadType: {
      type: String,
      enum: [
        "ABANDONED_CART",
        "ACTIVE_CART",
        "SUBSCRIBER",
        "WHATSAPP_LEAD",
      ],
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      index: true,
    },
    contact: {
      type: String,
      trim: true,
      index: true,
      default: "",
    },
    customerName: {
      type: String,
      trim: true,
      default: "",
    },
    lastUpdatedCartOn: {
      type: Date,
      index: true,
    },
    orderValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    enquiryCreatedOn: {
      type: Date,
      index: true,
    },
    enquiry: {
      type: String,
      trim: true,
      default: "",
    },
    source: {
      type: String,
      enum: ["web", "app", "admin", "unknown"],
      default: "unknown",
      index: true,
    },
  },
  { timestamps: true },
);

leadSchema.index({ leadType: 1, updatedAt: -1 });
leadSchema.index({ contact: 1, leadType: 1 });

const Lead = mongoose.model("Lead", leadSchema);

module.exports = Lead;
