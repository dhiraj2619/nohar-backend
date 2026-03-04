const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },

    discountType: {
      type: String,
      enum: ["FLAT", "PERCENTAGE"],
      required: true,
      default: "FLAT",
    },

    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },

    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // "Offer available on below products"
    applicableProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],

    applicablePaymentModes: [
      {
        type: String,
        enum: ["ONLINE", "COD", "WALLET", "UPI", "CARD", "NETBANKING"],
      },
    ],

    applicableStage: {
      type: String,
      enum: ["CART", "CHECKOUT", "PAYMENT"],
      default: "CHECKOUT",
    },

    // "Offer Eligibility" bullet points
    eligibilityNotes: [
      {
        type: String,
        trim: true,
      },
    ],

    // Optional limits
    maxDiscountAmount: {
      type: Number,
      default: null,
      min: 0,
    },

    usageLimitPerUser: {
      type: Number,
      default: null,
      min: 1,
    },

    totalUsageLimit: {
      type: Number,
      default: null,
      min: 1,
    },

    validFrom: {
      type: Date,
      default: null,
    },

    validTill: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Offer = mongoose.model("Offer", offerSchema);

module.exports = Offer;
