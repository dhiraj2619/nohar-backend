const Setting = require("../models/settings.model");

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
};

const getOrCreateSettings = async () => {
  let settings = await Setting.findOne();

  if (!settings) {
    settings = await Setting.create({});
  }

  return settings;
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
      storeName,
      supportEmail,
      supportPhone,
      address,
      currencyCode,
      orderPrefix,
      maintenanceMode,
      allowCod,
    } = req.body;

    if (storeName !== undefined) settings.storeName = String(storeName || "").trim();
    if (supportEmail !== undefined) {
      settings.supportEmail = String(supportEmail || "").trim().toLowerCase();
    }
    if (supportPhone !== undefined) {
      settings.supportPhone = String(supportPhone || "").trim();
    }
    if (address !== undefined) settings.address = String(address || "").trim();
    if (currencyCode !== undefined) {
      settings.currencyCode = String(currencyCode || "").trim().toUpperCase();
    }
    if (orderPrefix !== undefined) {
      settings.orderPrefix = String(orderPrefix || "").trim().toUpperCase();
    }
    if (maintenanceMode !== undefined) {
      settings.maintenanceMode = toBoolean(maintenanceMode, false);
    }
    if (allowCod !== undefined) {
      settings.allowCod = toBoolean(allowCod, true);
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
