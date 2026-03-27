const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    flatNo: {
      type: String,
      required: [true, "Flat/House number is required"],
      trim: true,
    },
    area: {
      type: String,
      trim: true,
    },
    landmark: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
    },
    country: {
      type: String,
      required: true,
      default: "India",
    },
    pincode: {
      type: String,
      required: true,
      match: [/^[1-9][0-9]{5}$/, "Please enter a valid 6-digit pincode"],
    },
    mobile: {
      type: String,
      required: true,
      match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit mobile number"],
    },
    type: {
      type: String,
      enum: ["Home", "Work", "Other"],
      default: "Home",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true },
);

const shippingInfoSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one shipping document per user
      index: true,
    },
    addresses: [addressSchema],
  },
  {
    timestamps: true,
  },
);

shippingInfoSchema.pre("save", function () {
  const defaultAddresses = this.addresses.filter((addr) => addr.isDefault);

  if (defaultAddresses.length > 1) {
    throw new Error("Only one address can be set as default");
  }
});

const ShippingInfo = mongoose.model("ShippingInfo", shippingInfoSchema);

module.exports = ShippingInfo;
