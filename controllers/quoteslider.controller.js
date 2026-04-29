const mongoose = require("mongoose");
const Cloudinary = require("cloudinary");

const QuoteSlider = require("../models/quoteslider.model");

const uploadQuoteSliderImage = async (file) => {
  if (!file?.path) return null;

  const uploadResult = await Cloudinary.v2.uploader.upload(file.path, {
    folder: "quote-sliders/images",
  });

  return {
    public_id: uploadResult.public_id,
    url: uploadResult.secure_url,
  };
};

const getQuoteSliders = async (req, res) => {
  try {
    const quoteSliders = await QuoteSlider.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: quoteSliders.length,
      data: quoteSliders,
    });
  } catch (error) {
    console.error("Error fetching quote sliders:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching quote sliders",
      error: error.message,
    });
  }
};

const createQuoteSlider = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    const image = await uploadQuoteSliderImage(req.file);
    const quoteSlider = await QuoteSlider.create({ image });

    return res.status(201).json({
      success: true,
      message: "Quote slider created successfully",
      data: quoteSlider,
    });
  } catch (error) {
    console.error("Error creating quote slider:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating quote slider",
      error: error.message,
    });
  }
};

const updateQuoteSlider = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quote slider id",
      });
    }

    const quoteSlider = await QuoteSlider.findById(id);

    if (!quoteSlider) {
      return res.status(404).json({
        success: false,
        message: "Quote slider not found",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    const image = await uploadQuoteSliderImage(req.file);

    if (quoteSlider.image?.public_id) {
      await Cloudinary.v2.uploader.destroy(quoteSlider.image.public_id);
    }

    quoteSlider.image = image;
    await quoteSlider.save();

    return res.status(200).json({
      success: true,
      message: "Quote slider updated successfully",
      data: quoteSlider,
    });
  } catch (error) {
    console.error("Error updating quote slider:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating quote slider",
      error: error.message,
    });
  }
};

const deleteQuoteSlider = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quote slider id",
      });
    }

    const quoteSlider = await QuoteSlider.findByIdAndDelete(id);

    if (!quoteSlider) {
      return res.status(404).json({
        success: false,
        message: "Quote slider not found",
      });
    }

    if (quoteSlider.image?.public_id) {
      await Cloudinary.v2.uploader.destroy(quoteSlider.image.public_id);
    }

    return res.status(200).json({
      success: true,
      message: "Quote slider deleted successfully",
      data: quoteSlider,
    });
  } catch (error) {
    console.error("Error deleting quote slider:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting quote slider",
      error: error.message,
    });
  }
};

module.exports = {
  getQuoteSliders,
  createQuoteSlider,
  updateQuoteSlider,
  deleteQuoteSlider,
};
