const mongoose = require("mongoose");

const collectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    thumbnail: {
      public_id: {
        type: String,
        required: [false, "Please upload a thumbnail image"],
      },
      url: {
        type: String,
        required: [false, "Please upload a thumbnail image"],
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

const Collection = mongoose.model("Collection", collectionSchema);

module.exports = Collection;
