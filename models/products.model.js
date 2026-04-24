const mongoose = require("mongoose");

const calculateFinalPrice = (price = 0, gst = 0, gstIncluded = true) => {
  const normalizedPrice = Number(price) || 0;
  const normalizedGst = Number(gst) || 0;

  if (!gstIncluded) return normalizedPrice;

  return Number(
    (normalizedPrice + (normalizedPrice * normalizedGst) / 100).toFixed(2),
  );
};

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    gst: {
      type: Number,
      default: 0,
      min: 0,
    },
    gstIncluded: {
      type: Boolean,
      default: true,
    },
    finalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    offerpercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    offerprice: {
      type: Number,
      default: 0,
      min: 0,
    },
    images: [
      {
        public_id: {
          type: String,
          required: false,
        },
        url: {
          type: String,
          required: false,
        },
      },
    ],
    guideImage: {
      public_id: {
        type: String,
        required: false,
      },
      url: {
        type: String,
        required: false,
      },
    },
    offers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Offer",
      },
    ],
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collection",
      required: true,
    },
    productReviews: [
      {
        userName: {
          type: String,
          required: true,
          trim: true,
        },
        review: {
          type: String,
          required: true,
          trim: true,
        },
        rating: {
          type: Number,
          required: true,
          min: 1,
          max: 5,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    ratings: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    emiAvailable: {
      type: Boolean,
      default: false,
    },
    emiStartsAt: {
      type: Number,
      default: 0,
      min: 0,
    },
    isMostBuy: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

productSchema.pre("save", function setFinalPrice(next) {
  this.finalPrice = calculateFinalPrice(this.price, this.gst, this.gstIncluded);
  next();
});

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
