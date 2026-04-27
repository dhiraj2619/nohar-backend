const AdminInfo = require("../models/adminInfo.model");
const Cloudinary = require("cloudinary");

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const getOrCreateSettings = async () => {
  let settings = await AdminInfo.findOne();

  if (!settings) {
    settings = await AdminInfo.create({});
  }

  return settings;
};

const uploadAuthorizedSignatoryImage = async (file) => {
  if (!file?.path) return null;

  const uploadResult = await Cloudinary.v2.uploader.upload(file.path, {
    folder: "admin-info/authorized-signatory",
  });

  return {
    public_id: uploadResult.public_id,
    url: uploadResult.secure_url,
  };
};

const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching settings",
      error: error.message,
    });
  }
};

const updateSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    const {
      ownerName,
      email,
      address,
      maintenanceMode,
      allowCOD,
      allowCod,
      freeShippingAbove,
      removeAuthorizedSignatory,
    } = req.body;

    if (ownerName !== undefined) {
      settings.ownerName = String(ownerName || "").trim();
    }
    if (email !== undefined) {
      settings.email = String(email || "").trim().toLowerCase();
    }
    if (address !== undefined) settings.address = String(address || "").trim();
    if (maintenanceMode !== undefined) {
      settings.maintenanceMode = toBoolean(maintenanceMode, false);
    }
    if (allowCOD !== undefined || allowCod !== undefined) {
      settings.allowCOD = toBoolean(
        allowCOD !== undefined ? allowCOD : allowCod,
        true,
      );
    }
    if (freeShippingAbove !== undefined) {
      const normalizedFreeShippingAbove = Number(freeShippingAbove);
      settings.freeShippingAbove = Number.isNaN(normalizedFreeShippingAbove)
        ? settings.freeShippingAbove
        : normalizedFreeShippingAbove;
    }

    if (
      toBoolean(removeAuthorizedSignatory, false) &&
      settings.authorizedSignatory?.public_id
    ) {
      await Cloudinary.v2.uploader.destroy(settings.authorizedSignatory.public_id);
      settings.authorizedSignatory = null;
    }

    if (req.file) {
      const authorizedSignatory = await uploadAuthorizedSignatoryImage(req.file);

      if (settings.authorizedSignatory?.public_id) {
        await Cloudinary.v2.uploader.destroy(
          settings.authorizedSignatory.public_id,
        );
      }

      settings.authorizedSignatory = authorizedSignatory;
    }

    await settings.save();

    return res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating settings",
      error: error.message,
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
};
