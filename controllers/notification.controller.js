const mongoose = require("mongoose");
const Cloudinary = require("cloudinary");
const Notification = require("../models/notification.model");
const User = require("../models/users.model");
const { sendPushToUsers } = require("../services/notification.service");

const parseArrayField = (value, defaultValue = []) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : defaultValue;
    } catch (error) {
      return defaultValue;
    }
  }

  return defaultValue;
};

const uploadNotificationImage = async (file) => {
  if (!file?.path) {
    return null;
  }

  const uploadResult = await Cloudinary.v2.uploader.upload(file.path, {
    folder: "notifications/images",
  });

  return {
    public_id: uploadResult.public_id,
    url: uploadResult.secure_url,
  };
};

const normalizeRecipientIds = (value) =>
  parseArrayField(value, [])
    .map((item) => String(item || "").trim())
    .filter((item) => mongoose.Types.ObjectId.isValid(item));

const pushTokenQuery = {
  $exists: true,
  $type: "string",
  $regex: /\S/,
};

const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .populate("recipients", "fullName phone email")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
    });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification id",
      });
    }

    const notification = await Notification.findByIdAndDelete(id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    if (notification.image?.public_id) {
      await Cloudinary.v2.uploader.destroy(notification.image.public_id);
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      data: notification,
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      error: error.message,
    });
  }
};

const createNotification = async (req, res) => {
  try {
    const { title, description, audienceType = "all", recipientIds } = req.body;
    const normalizedTitle = String(title || "").trim();
    const normalizedDescription = String(description || "").trim();
    const normalizedAudienceType = String(audienceType || "all")
      .trim()
      .toLowerCase();

    if (!normalizedTitle || !normalizedDescription) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    if (!["all", "selected"].includes(normalizedAudienceType)) {
      return res.status(400).json({
        success: false,
        message: "audienceType must be all or selected",
      });
    }

    const selectedRecipientIds = normalizeRecipientIds(recipientIds);

    if (
      normalizedAudienceType === "selected" &&
      selectedRecipientIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Select at least one customer for selected notifications",
      });
    }

    const query =
      normalizedAudienceType === "all"
        ? { fcmToken: pushTokenQuery }
        : {
            _id: { $in: selectedRecipientIds },
            fcmToken: pushTokenQuery,
          };

    const recipients = await User.find(query).select(
      "_id fullName phone email fcmToken",
    );

    if (!recipients.length) {
      return res.status(404).json({
        success: false,
        message: "No customers with registered push tokens were found",
      });
    }

    const image = await uploadNotificationImage(req.file);

    const deliveryResult = await sendPushToUsers({
      users: recipients,
      title: normalizedTitle,
      body: normalizedDescription,
      data: {
        type: "ADMIN_NOTIFICATION",
        audienceType: normalizedAudienceType,
        title: normalizedTitle,
        body: normalizedDescription,
        description: normalizedDescription,
        imageUrl: image?.url || "",
      },
      imageUrl: image?.url,
    });

    const status =
      deliveryResult.sentCount > 0 && deliveryResult.failureCount === 0
        ? "sent"
        : deliveryResult.sentCount > 0
          ? "partial"
          : "failed";

    const notification = await Notification.create({
      title: normalizedTitle,
      description: normalizedDescription,
      image,
      audienceType: normalizedAudienceType,
      recipients: recipients.map((user) => user._id),
      recipientCount: recipients.length,
      sentCount: deliveryResult.sentCount || 0,
      failureCount: deliveryResult.failureCount || 0,
      invalidTokensRemoved: deliveryResult.invalidTokensRemoved || 0,
      status,
      createdBy: {
        id: req.admin?.id || null,
        email: req.admin?.email || null,
        role: req.admin?.role || "owner",
      },
    });

    const populatedNotification = await Notification.findById(notification._id)
      .populate("recipients", "fullName phone email");

    return res.status(201).json({
      success: true,
      message:
        status === "sent"
          ? "Notification sent successfully"
          : status === "partial"
            ? "Notification sent to some customers"
            : deliveryResult.message || "Notification could not be delivered",
      data: populatedNotification,
      delivery: deliveryResult,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error.message,
    });
  }
};

module.exports = {
  getNotifications,
  createNotification,
  deleteNotification,
};
