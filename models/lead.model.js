const mongoose = require("mongoose");

const cartItemSnapshotSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    image: {
      type: String,
      trim: true,
      default: "",
    },
    quantity: {
      type: Number,
      default: 1,
      min: 0,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

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
    cartItems: {
      type: [cartItemSnapshotSchema],
      default: [],
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
