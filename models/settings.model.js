const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    storeName: {
      type: String,
      trim: true,
      default: "Nohar",
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    supportPhone: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    currencyCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "INR",
    },
    orderPrefix: {
      type: String,
      trim: true,
      uppercase: true,
      default: "NOH",
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    allowCod: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Setting = mongoose.model("Setting", settingsSchema);

module.exports = Setting;
