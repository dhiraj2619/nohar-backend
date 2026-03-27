const mongoose = require("mongoose");
const ShippingInfo = require("../models/shippingInfo.model");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const addOrUpdateShippingInfo = async (req, res) => {
  try {
    const {
      userId,
      flatNo,
      area,
      landmark,
      city,
      state,
      mobile,
      pincode,
      country,
      type,
      isDefault,
    } = req.body;

    const finalUserId = userId || req.user?._id || req.user?.id;

    if (!finalUserId || !isValidObjectId(finalUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID is required",
      });
    }

    const sanitizedAddress = {
      flatNo: flatNo || "",
      area: area || "",
      landmark: landmark || "",
      city: city || "",
      state: state || "",
      mobile: mobile || "",
      pincode: pincode || "",
      country: country || "India",
      type: type || "Home",
      isDefault: isDefault ?? true,
    };

    let shippingInfo = await ShippingInfo.findOne({ user: finalUserId });

    if (shippingInfo) {
      if (sanitizedAddress.isDefault) {
        shippingInfo.addresses.forEach((address) => {
          address.isDefault = false;
        });
      }

      shippingInfo.addresses.push(sanitizedAddress);
      await shippingInfo.save();

      return res.status(200).json({
        success: true,
        message: "New address added successfully",
        shippingInfo,
      });
    }

    const newShippingInfo = new ShippingInfo({
      user: finalUserId,
      addresses: [sanitizedAddress],
    });

    await newShippingInfo.save();

    return res.status(201).json({
      success: true,
      message: "Shipping info saved successfully",
      shippingInfo: newShippingInfo,
    });
  } catch (error) {
    console.error("Add shipping info error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
};

const getShippingInfo = async (req, res) => {
  try {
    const userId = req.params.id || req.user?._id || req.user?.id;

    if (!userId || !isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID is required",
      });
    }

    const shippingInfo = await ShippingInfo.findOne({ user: userId });

    if (!shippingInfo) {
      return res.status(404).json({
        success: false,
        message: "No shipping info found",
      });
    }

    return res.status(200).json({
      success: true,
      shippingInfo,
    });
  } catch (error) {
    console.error("Get shipping info error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { userId, addressId, updatedFields = {} } = req.body;
    const finalUserId = userId || req.user?._id || req.user?.id;

    if (!finalUserId || !isValidObjectId(finalUserId) || !addressId) {
      return res.status(400).json({
        success: false,
        message: "Valid userId and addressId are required",
      });
    }

    const shippingInfo = await ShippingInfo.findOne({ user: finalUserId });

    if (!shippingInfo) {
      return res.status(404).json({
        success: false,
        message: "Shipping info not found",
      });
    }

    const addressIndex = shippingInfo.addresses.findIndex(
      (address) => address._id.toString() === addressId,
    );

    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    if (updatedFields.isDefault === true) {
      shippingInfo.addresses.forEach((address) => {
        address.isDefault = false;
      });
    }

    Object.assign(shippingInfo.addresses[addressIndex], updatedFields);

    await shippingInfo.save();

    return res.status(200).json({
      success: true,
      message: "Address updated successfully",
      shippingInfo,
    });
  } catch (error) {
    console.error("Update address error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  addOrUpdateShippingInfo,
  getShippingInfo,
  updateAddress,
};
