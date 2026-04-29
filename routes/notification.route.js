const express = require("express");
const upload = require("../config/multerConfig");
const { isAdminAuth } = require("../middlewares/auth.middleware");
const {
  getNotifications,
  createNotification,
  deleteNotification,
} = require("../controllers/notification.controller");

const notificationRouter = express.Router();

notificationRouter.get("/", isAdminAuth, getNotifications);
notificationRouter.post(
  "/",
  isAdminAuth,
  upload.single("image"),
  createNotification,
);
notificationRouter.delete("/:id", isAdminAuth, deleteNotification);

module.exports = { notificationRouter };
