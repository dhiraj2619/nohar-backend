const mongoose = require("mongoose");
const Cloudinary = require("cloudinary");

const Product = require("../models/products.model");
const Category = require("../models/categories.model");
const Collection = require("../models/collection.model");
const Offer = require("../models/offers.model");

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseArrayField = (value, defaultValue = []) => {
  if (value === undefined || value === null || value === "")
    return defaultValue;
  if (Array.isArray(value)) return value;

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

const parseObjectIdArrayField = (value, defaultValue = []) => {
  if (value === undefined || value === null || value === "")
    return defaultValue;

  if (Array.isArray(value)) {
    return value.filter(
      (item) => typeof item === "string" && item.trim() !== "",
    );
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) return defaultValue;

    try {
      const parsed = JSON.parse(trimmedValue);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item) => typeof item === "string" && item.trim() !== "",
        );
      }
    } catch (error) {
      // If it is not JSON, treat it as a single id value.
    }

    return [trimmedValue];
  }

  return defaultValue;
};

const getProductImageFiles = (files = {}) => {
  if (Array.isArray(files.images) && files.images.length) return files.images;
  if (Array.isArray(files.image) && files.image.length) return files.image;
  return [];
};

const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      offerpercent,
      offerprice,
      categoryId,
      collectionId,
      offers,
      productReviews,
      ratings,
      emiAvailable,
      emiStartsAt,
    } = req.body;

    if (!name || !description || !price || !categoryId || !collectionId) {
      return res.status(400).json({
        success: false,
        message:
          "Name, description, price, categoryId, and collectionId are required fields",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid categoryId",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(collectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid collectionId",
      });
    }

    const existingCategory = await Category.findById(categoryId);
    const existingCollection = await Collection.findById(collectionId);
    const offerIds = parseObjectIdArrayField(offers, []);

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (!existingCollection) {
      return res.status(404).json({
        success: false,
        message: "Collection not found",
      });
    }

    if (offerIds.some((offerId) => !mongoose.Types.ObjectId.isValid(offerId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid offer id in offers array",
      });
    }

    if (offerIds.length) {
      const existingOffersCount = await Offer.countDocuments({
        _id: { $in: offerIds },
      });
      if (existingOffersCount !== offerIds.length) {
        return res.status(404).json({
          success: false,
          message: "One or more offers not found",
        });
      }
    }

    const productImageFiles = getProductImageFiles(req.files);

    if (!productImageFiles.length) {
      return res.status(400).json({
        success: false,
        message: "Please upload product images",
      });
    }

    const uploadedImages = await Promise.all(
      productImageFiles.map(async (file) => {
        const imageResult = await Cloudinary.v2.uploader.upload(file.path, {
          folder: "products/images",
        });

        return {
          public_id: imageResult.public_id,
          url: imageResult.secure_url,
        };
      }),
    );

    let guideImage = {};

    if (req.files.guideImage) {
      const guideImageResult = await Cloudinary.v2.uploader.upload(
        req.files.guideImage[0].path,
        {
          folder: "products/guide-images",
        },
      );

      guideImage = {
        public_id: guideImageResult.public_id,
        url: guideImageResult.secure_url,
      };
    }

    const normalizedPrice = toNumber(price, 0);
    const normalizedOfferPercent = toNumber(offerpercent, 0);
    const calculatedOfferPrice = Number(
      (
        normalizedPrice -
        (normalizedPrice * normalizedOfferPercent) / 100
      ).toFixed(2),
    );

    const newProduct = await Product.create({
      name: name.trim(),
      description,
      price: normalizedPrice,
      offerpercent: normalizedOfferPercent,
      offerprice:
        offerprice !== undefined
          ? toNumber(offerprice, 0)
          : Math.max(calculatedOfferPrice, 0),
      images: uploadedImages,
      guideImage,
      offers: offerIds,
      categoryId,
      collectionId,
      productReviews: parseArrayField(productReviews, []),
      ratings: toNumber(ratings, 0),
      emiAvailable: toBoolean(emiAvailable),
      emiStartsAt: toNumber(emiStartsAt, 0),
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: newProduct,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the product",
      error: error.message,
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const {
      name,
      description,
      price,
      offerpercent,
      offerprice,
      categoryId,
      collectionId,
      offers,
      productReviews,
      ratings,
      emiAvailable,
      emiStartsAt,
    } = req.body;
    const offerIds = parseObjectIdArrayField(offers, product.offers);

    if (categoryId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
        });
      }

      const existingCategory = await Category.findById(categoryId);
      if (!existingCategory) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      product.categoryId = categoryId;
    }

    if (collectionId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(collectionId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid collectionId",
        });
      }

      const existingCollection = await Collection.findById(collectionId);
      if (!existingCollection) {
        return res.status(404).json({
          success: false,
          message: "Collection not found",
        });
      }

      product.collectionId = collectionId;
    }

    if (offers !== undefined) {
      if (
        offerIds.some((offerId) => !mongoose.Types.ObjectId.isValid(offerId))
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer id in offers array",
        });
      }

      if (offerIds.length) {
        const existingOffersCount = await Offer.countDocuments({
          _id: { $in: offerIds },
        });
        if (existingOffersCount !== offerIds.length) {
          return res.status(404).json({
            success: false,
            message: "One or more offers not found",
          });
        }
      }
    }

    const newProductImageFiles = getProductImageFiles(req.files);
    if (newProductImageFiles.length) {
      const uploadedImages = await Promise.all(
        newProductImageFiles.map(async (file) => {
          const imageResult = await Cloudinary.v2.uploader.upload(file.path, {
            folder: "products/images",
          });

          return {
            public_id: imageResult.public_id,
            url: imageResult.secure_url,
          };
        }),
      );

      const existingImagePublicIds = Array.isArray(product.images)
        ? product.images.map((img) => img?.public_id).filter(Boolean)
        : [];

      await Promise.all(
        existingImagePublicIds.map((publicId) =>
          Cloudinary.v2.uploader.destroy(publicId),
        ),
      );

      product.images = uploadedImages;
    }

    if (req.files && req.files.guideImage) {
      const guideImageResult = await Cloudinary.v2.uploader.upload(
        req.files.guideImage[0].path,
        {
          folder: "products/guide-images",
        },
      );

      if (product.guideImage?.public_id) {
        await Cloudinary.v2.uploader.destroy(product.guideImage.public_id);
      }

      product.guideImage = {
        public_id: guideImageResult.public_id,
        url: guideImageResult.secure_url,
      };
    }

    if (name !== undefined) product.name = name.trim();
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = toNumber(price, product.price);
    if (offerpercent !== undefined) {
      product.offerpercent = toNumber(offerpercent, product.offerpercent);
    }
    if (offerprice !== undefined)
      product.offerprice = toNumber(offerprice, product.offerprice);
    if (offers !== undefined) product.offers = offerIds;
    if (productReviews !== undefined) {
      product.productReviews = parseArrayField(
        productReviews,
        product.productReviews,
      );
    }
    if (ratings !== undefined)
      product.ratings = toNumber(ratings, product.ratings);
    if (emiAvailable !== undefined)
      product.emiAvailable = toBoolean(emiAvailable);
    if (emiStartsAt !== undefined)
      product.emiStartsAt = toNumber(emiStartsAt, product.emiStartsAt);

    const updatedProduct = await product.save();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the product",
      error: error.message,
    });
  }
};

const getProductsBycollections = async (req, res) => {
  try {
    const { collectionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(collectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid collectionId",
      });
    }

    const products = await Product.find({ collectionId })
      .populate("categoryId", "name")
      .populate("collectionId", "name")
      .populate("offers")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Products by collection retrieved successfully",
      data: products,
    });
  } catch (error) {
    console.error("Error retrieving products by collection:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while retrieving products by collection",
      error: error.message,
    });
  }
};

const getProductsByCategories = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid categoryId",
      });
    }

    const products = await Product.find({ categoryId })
      .populate("categoryId", "name")
      .populate("collectionId", "name")
      .populate("offers")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Products by category retrieved successfully",
      data: products,
    });
  } catch (error) {
    console.error("Error retrieving products by category:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while retrieving products by category",
      error: error.message,
    });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const product = await Product.findById(id)
      .populate("categoryId", "name")
      .populate("collectionId", "name")
      .populate("offers");

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      data: product,
    });
  } catch (error) {
    console.error("Error retrieving product:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while retrieving the product",
      error: error.message,
    });
  }
};

module.exports = {
  createProduct,
  updateProduct,
  getProductsBycollections,
  getProductsByCategories,
  getProductById,
};
