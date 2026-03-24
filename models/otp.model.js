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
      required: true,
    },
    otpExpiry: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

const Otp = mongoose.model("Otp", otpSchema);

module.exports = Otp;
