const express = require("express");
const multer = require("multer");
const { isAdminAuth } = require("../middlewares/auth.middleware");
const { getBroadcasts, getBroadcast, createBroadcast, updateBroadcast, deleteBroadcast } = require("../controllers/broadcast.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 },
  fileFilter: (req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return callback(new Error("Upload a JPG, PNG, WebP or GIF image"));
    }
    callback(null, true);
  },
}).single("image");
const uploadImage = (req, res, next) => upload(req, res, (error) => {
  if (error) return res.status(400).json({ success: false, message: error.code === "LIMIT_FILE_SIZE" ? "Image must be 5 MB or smaller" : error.message });
  next();
});

const broadcastRouter = express.Router();
broadcastRouter.use(isAdminAuth);
broadcastRouter.get("/", getBroadcasts);
broadcastRouter.get("/:id", getBroadcast);
broadcastRouter.post("/", uploadImage, createBroadcast);
broadcastRouter.patch("/:id", uploadImage, updateBroadcast);
broadcastRouter.delete("/:id", deleteBroadcast);
module.exports = { broadcastRouter };
