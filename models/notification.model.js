const mongoose = require("mongoose");

const notificationImageSchema = new mongoose.Schema(
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

const notificationSchema = new mongoose.Schema(
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
    image: {
      type: notificationImageSchema,
      default: null,
    },
    audienceType: {
      type: String,
      enum: ["all", "selected"],
      required: true,
      default: "all",
    },
    recipients: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    recipientCount: {
      type: Number,
      default: 0,
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    invalidTokensRemoved: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["sent", "partial", "failed"],
      default: "sent",
    },
    createdBy: {
      id: {
        type: String,
        default: null,
      },
      email: {
        type: String,
        default: null,
      },
      role: {
        type: String,
        default: "owner",
      },
    },
  },
  { timestamps: true },
);

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
