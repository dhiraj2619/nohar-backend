const mongoose = require("mongoose");

const mediaSchema = new mongoose.Schema(
  {
    public_id: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

const quoteSliderSchema = new mongoose.Schema(
  {
    image: {
      type: mediaSchema,
      required: true,
    },
  },
  { timestamps: true },
);

const QuoteSlider = mongoose.model("QuoteSlider", quoteSliderSchema);

module.exports = QuoteSlider;
