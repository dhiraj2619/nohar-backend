const mongoose = require("mongoose");

const mediaSchema = new mongoose.Schema(
  {
    public_id: {
      type: String,
      default: null,
    },
    url: {
      type: String,
      default: null,
    },
  },
  { _id: false },
);

const adminInfoSchema = new mongoose.Schema(
  {
    ownerName: {
      type: String,
      trim: true,
      default: "Nohar Owner",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "noharcosmetics@gmail.com",
    },
    address: {
      type: String,
      trim: true,
      default: "Dwarka Circle, Kathe Lane, Nashik, Maharashtra, India",
    },
    authorizedSignatory: {
      type: mediaSchema,
      default: null,
    },
    allowCOD: {
      type: Boolean,
      default: true,
    },
    freeShippingAbove: {
      type: Number,
      default: 0,
      min: 0,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const AdminInfo = mongoose.model("AdminInfo", adminInfoSchema);

module.exports = AdminInfo;
