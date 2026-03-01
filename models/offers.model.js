const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    offerName: {
      type: String,
      required: true,
      trim: true,
    },
    offerDesc: {
      type: String,
      required: false,
      trim: true,
    },
    offerpercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    offeravailable: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Offer = mongoose.model("Offer", offerSchema);

module.exports = Offer;
