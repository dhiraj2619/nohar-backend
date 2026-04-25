const mongoose = require("mongoose");
const Cloudinary = require("cloudinary");

const Ad = require("../models/ads.model");

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const normalizeVideoLink = (value) => {
  if (value === undefined) return undefined;
  const normalized = String(value || "").trim();
  return normalized || null;
};

const uploadAdImage = async (file) => {
  if (!file?.path) return null;

  const imageResult = await Cloudinary.v2.uploader.upload(file.path, {
    folder: "ads/images",
  });

  return {
    public_id: imageResult.public_id,
    url: imageResult.secure_url,
  };
};

const getAds = async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: ads.length,
      data: ads,
    });
  } catch (error) {
    console.error("Error fetching ads:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching ads",
      error: error.message,
    });
  }
};

const createAd = async (req, res) => {
  try {
    const { title, videoLink, isActive } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }

    const image = await uploadAdImage(req.file);

    const ad = await Ad.create({
      title: String(title).trim(),
      videoLink: normalizeVideoLink(videoLink) ?? null,
      image,
      isActive: toBoolean(isActive, true),
    });

    return res.status(201).json({
      success: true,
      message: "Ad created successfully",
      data: ad,
    });
  } catch (error) {
    console.error("Error creating ad:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the ad",
      error: error.message,
    });
  }
};

const updateAd = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ad id",
      });
    }

    const ad = await Ad.findById(id);

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Ad not found",
      });
    }

    const { title, videoLink, isActive, removeImage } = req.body;

    if (title !== undefined) {
      const normalizedTitle = String(title || "").trim();

      if (!normalizedTitle) {
        return res.status(400).json({
          success: false,
          message: "Title cannot be empty",
        });
      }

      ad.title = normalizedTitle;
    }

    if (videoLink !== undefined) {
      ad.videoLink = normalizeVideoLink(videoLink);
    }

    if (isActive !== undefined) {
      ad.isActive = toBoolean(isActive, true);
    }

    if (toBoolean(removeImage, false) && ad.image?.public_id) {
      await Cloudinary.v2.uploader.destroy(ad.image.public_id);
      ad.image = null;
    }

    if (req.file) {
      const image = await uploadAdImage(req.file);

      if (ad.image?.public_id) {
        await Cloudinary.v2.uploader.destroy(ad.image.public_id);
      }

      ad.image = image;
    }

    await ad.save();

    return res.status(200).json({
      success: true,
      message: "Ad updated successfully",
      data: ad,
    });
  } catch (error) {
    console.error("Error updating ad:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the ad",
      error: error.message,
    });
  }
};

const deleteAd = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ad id",
      });
    }

    const ad = await Ad.findByIdAndDelete(id);

    if (!ad) {
      return res.status(404).json({
        success: false,
        message: "Ad not found",
      });
    }

    if (ad.image?.public_id) {
      await Cloudinary.v2.uploader.destroy(ad.image.public_id);
    }

    return res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
      data: ad,
    });
  } catch (error) {
    console.error("Error deleting ad:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting the ad",
      error: error.message,
    });
  }
};

module.exports = {
  getAds,
  createAd,
  updateAd,
  deleteAd,
};
