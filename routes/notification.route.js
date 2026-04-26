const express = require("express");
const upload = require("../config/multerConfig");
const { isAdminAuth } = require("../middlewares/auth.middleware");
const {
  getNotifications,
  createNotification,
} = require("../controllers/notification.controller");

const notificationRouter = express.Router();

notificationRouter.get("/", isAdminAuth, getNotifications);
notificationRouter.post(
  "/",
  isAdminAuth,
  upload.single("image"),
  createNotification,
);

module.exports = { notificationRouter };
