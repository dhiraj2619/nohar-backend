const { default: mongoose } = require("mongoose");
const Offer = require("../models/offers.model");
const Product = require("../models/products.model");

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
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

const parseObjectIdArray = (value) => {
  const arr = parseArrayField(value, []);

  return arr
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return String(item._id || item.id || item.value || "").trim();
      }
      return "";
    })
    .filter(Boolean);
};

const parseDateOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "INVALID" : d;
};

const getOffers = async (req, res) => {
  try {
    const { isActive, search } = req.query;

    const filter = {};

    if (isActive !== undefined) {
      filter.isActive = toBoolean(isActive, true);
    }

    if (search && String(search).trim() !== "") {
      const pattern = String(search).trim();
      filter.$or = [
        { title: { $regex: pattern, $options: "i" } },
        { code: { $regex: pattern, $options: "i" } },
        { description: { $regex: pattern, $options: "i" } },
      ];
    }

    const offers = await Offer.find(filter)
      .populate("applicableProducts", "name price discountprice")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: offers.length,
      data: offers,
    });
  } catch (error) {
    console.error("Error fetching offers:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching offers",
      error: error.message,
    });
  }
};

const createOffer = async (req, res) => {
  try {
    const {
      title,
      description,
      code,
      discountType = "FLAT",
      discountValue,
      minOrderAmount,
      applicableProducts,
      applicablePaymentModes,
      applicableStage = "CHECKOUT",
      eligibilityNotes,
      maxDiscountAmount,
      usageLimitPerUser,
      totalUsageLimit,
      validFrom,
      validTill,
      isActive,
    } = req.body;

    if (!title || !code || discountValue === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "title, code and discountValue are required fields",
      });
    }

    const normalizedCode = String(code).trim().toUpperCase();

    const existingCode = await Offer.findOne({ code: normalizedCode });

    if (existingCode) {
      return res.status(400).json({
        success: false,
        message: "Offer code already exists",
      });
    }

    const productIds = parseObjectIdArray(applicableProducts);

    if (productIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id in applicableProducts",
      });
    }

    if (productIds.length) {
      const count = await Product.countDocuments({ _id: { $in: productIds } });

      if (count !== productIds.length) {
        return res.status(404).json({
          success: false,
          message: "One or more applicableProducts not found",
        });
      }
    }

    const fromDate = parseDateOrNull(validFrom);
    const tillDate = parseDateOrNull(validTill);

    if (fromDate === "INVALID" || tillDate === "INVALID") {
      return res.status(400).json({
        success: false,
        message: "Invalid validFrom or validTill date",
      });
    }

    if (fromDate && tillDate && tillDate < fromDate) {
      return res.status(400).json({
        success: false,
        message: "validTill must be greater than or equal to validFrom",
      });
    }

    const newOffer = await Offer.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,
      code: normalizedCode,
      discountType,
      discountValue: toNumber(discountValue, 0),
      minOrderAmount: toNumber(minOrderAmount, 0),
      applicableProducts: productIds,
      applicablePaymentModes: parseArrayField(applicablePaymentModes, []),
      applicableStage,
      eligibilityNotes: parseArrayField(eligibilityNotes, []),
      maxDiscountAmount: toNumber(maxDiscountAmount, null),
      usageLimitPerUser: toNumber(usageLimitPerUser, null),
      totalUsageLimit: toNumber(totalUsageLimit, null),
      validFrom: fromDate,
      validTill: tillDate,
      isActive: toBoolean(isActive, true),
    });

    return res.status(201).json({
      success: true,
      message: "Offer created successfully",
      data: newOffer,
    });
  } catch (error) {
    console.error("Error creating offer:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the offer",
      error: error.message,
    });
  }
};

const updateOffer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid offer id",
      });
    }

    const offer = await Offer.findById(id);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    const {
      title,
      description,
      code,
      discountType,
      discountValue,
      minOrderAmount,
      applicableProducts,
      applicablePaymentModes,
      applicableStage,
      eligibilityNotes,
      maxDiscountAmount,
      usageLimitPerUser,
      totalUsageLimit,
      validFrom,
      validTill,
      isActive,
    } = req.body;

    if (code !== undefined) {
      const normalizedCode = String(code).trim().toUpperCase();
      const duplicate = await Offer.findOne({
        code: normalizedCode,
        _id: { $ne: id },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: "Offer code already exists",
        });
      }
      offer.code = normalizedCode;
    }

    if (applicableProducts !== undefined) {
      const productIds = parseObjectIdArray(applicableProducts);
      if (productIds.some((pid) => !mongoose.Types.ObjectId.isValid(pid))) {
        return res.status(400).json({
          success: false,
          message: "Invalid product id in applicableProducts",
        });
      }

      if (productIds.length) {
        const count = await Product.countDocuments({
          _id: { $in: productIds },
        });
        if (count !== productIds.length) {
          return res.status(404).json({
            success: false,
            message: "One or more applicableProducts not found",
          });
        }
      }

      offer.applicableProducts = productIds;
    }

    if (validFrom !== undefined) {
      const parsed = parseDateOrNull(validFrom);
      if (parsed === "INVALID") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid validFrom date" });
      }
      offer.validFrom = parsed;
    }

    if (validTill !== undefined) {
      const parsed = parseDateOrNull(validTill);
      if (parsed === "INVALID") {
        return res
          .status(400)
          .json({ success: false, message: "Invalid validTill date" });
      }
      offer.validTill = parsed;
    }

    const currentFrom = offer.validFrom || null;
    const currentTill = offer.validTill || null;
    if (currentFrom && currentTill && currentTill < currentFrom) {
      return res.status(400).json({
        success: false,
        message: "validTill must be greater than or equal to validFrom",
      });
    }

    if (title !== undefined) offer.title = String(title).trim();
    if (description !== undefined)
      offer.description = description ? String(description).trim() : undefined;
    if (discountType !== undefined) offer.discountType = discountType;
    if (discountValue !== undefined)
      offer.discountValue = toNumber(discountValue, 0);
    if (minOrderAmount !== undefined)
      offer.minOrderAmount = toNumber(minOrderAmount, 0);
    if (applicablePaymentModes !== undefined)
      offer.applicablePaymentModes = parseArrayField(
        applicablePaymentModes,
        [],
      );
    if (applicableStage !== undefined) offer.applicableStage = applicableStage;
    if (eligibilityNotes !== undefined)
      offer.eligibilityNotes = parseArrayField(eligibilityNotes, []);
    if (maxDiscountAmount !== undefined)
      offer.maxDiscountAmount = toNumber(maxDiscountAmount, null);
    if (usageLimitPerUser !== undefined)
      offer.usageLimitPerUser = toNumber(usageLimitPerUser, null);
    if (totalUsageLimit !== undefined)
      offer.totalUsageLimit = toNumber(totalUsageLimit, null);
    if (isActive !== undefined) offer.isActive = toBoolean(isActive, true);

    const updatedOffer = await offer.save();

    return res.status(200).json({
      success: true,
      message: "Offer updated successfully",
      data: updatedOffer,
    });
  } catch (error) {
    console.error("Error updating offer:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the offer",
      error: error.message,
    });
  }
};

const deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid offer id",
      });
    }

    const deletedOffer = await Offer.findByIdAndDelete(id);

    if (!deletedOffer) {
      return res.status(404).json({
        success: false,
        message: "Offer not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Offer deleted successfully",
      data: deletedOffer,
    });
  } catch (error) {
    console.error("Error deleting offer:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting the offer",
      error: error.message,
    });
  }
};

module.exports = { getOffers, createOffer, updateOffer, deleteOffer };
