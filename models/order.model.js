const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    product: {
      type: mongoose.Schema.ObjectId,
      ref: "Product",
      required: true,
    },
  },
  { _id: false },
);

const shippingInfoSchema = new mongoose.Schema(
  {
    flatNo: {
      type: String,
      required: true,
    },
    area: {
      type: String,
      required: false,
    },
    landmark: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    mobile: {
      type: String,
      required: true,
    },
    pincode: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
    shippingInfo: {
      type: shippingInfoSchema,
      required: true,
    },
    orderItems: {
      type: [orderItemSchema],
      required: true,
    },
    payment: {
      type: mongoose.Schema.ObjectId,
      ref: "payment",
    },
    paymentMode: {
      type: String,
      required: true,
      enum: ["PARTIAL_COD", "FULL"],
    },
    paymentStatus: {
      type: String,
      required: true,
      default: "PENDING",
      enum: ["PENDING", "PARTIALLY_PAID", "PAID"],
    },
    partialPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    amountPaid: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    amountDue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    remainingPaymentMethod: {
      type: String,
      enum: ["COD"],
      default: "COD",
    },
    paidAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      default: () => `ORDER-#${Math.floor(100000 + Math.random() * 900000)}`,
    },
    orderStatus: {
      type: String,
      required: true,
      default: "ORDER_PLACED",
      enum: [
        "ORDER_PLACED",
        "READY_TO_PICK",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
      ],
    },
    deliveredAt: Date,
    readyToPickAt: Date,
    inTransitAt: Date,
    shippedAt: Date,
    outForDeliveryAt: Date,
  },
  { timestamps: true },
);

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
