const AdminInfo = require("../models/adminInfo.model");
const Cloudinary = require("cloudinary");

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) {
    if (!value.length) return fallback;
    return toBoolean(value[value.length - 1], fallback);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalizedValue)) return true;
    if (["false", "0", "no", "off"].includes(normalizedValue)) return false;

    return fallback;
  }
  return Boolean(value);
};

const normalizePartialPaymentType = (value, fallback = "PERCENT") => {
  const normalizedValue = String(value || "")
    .trim()
    .toUpperCase();

  if (normalizedValue === "PERCENT" || normalizedValue === "FLAT") {
    return normalizedValue;
  }

  return fallback;
};

const applyNoStoreHeaders = (res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
};

const getOrCreateSettings = async () => {
  let settings = await AdminInfo.findOne();

  if (!settings) {
    settings = await AdminInfo.create({});
  }

  return settings;
};

const buildPublicSettingsPayload = (settings) => ({
  allowCOD:
    settings?.allowCOD !== undefined ? Boolean(settings.allowCOD) : true,
  allowPartial:
    settings?.allowPartial !== undefined ? Boolean(settings.allowPartial) : false,
  partialPaymentType:
    normalizePartialPaymentType(settings?.partialPaymentType, "PERCENT"),
  partialPaymentValue:
    settings?.partialPaymentValue !== undefined &&
    settings?.partialPaymentValue !== null
      ? Number(settings.partialPaymentValue)
      : 0,
  freeShippingAbove:
    settings?.freeShippingAbove !== undefined &&
    settings?.freeShippingAbove !== null
      ? Number(settings.freeShippingAbove)
      : 0,
  maintenanceMode:
    settings?.maintenanceMode !== undefined
      ? Boolean(settings.maintenanceMode)
      : false,
  updatedAt: settings?.updatedAt || settings?.createdAt || new Date(),
});

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
    applyNoStoreHeaders(res);

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

const getPublicSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    applyNoStoreHeaders(res);

    return res.status(200).json({
      success: true,
      data: buildPublicSettingsPayload(settings),
    });
  } catch (error) {
    console.error("Error fetching public settings:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching public settings",
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
      gstNumber,
      maintenanceMode,
      allowCOD,
      allowCod,
      allowPartial,
      partialPaymentType,
      partialPaymentValue,
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
    if (gstNumber !== undefined) {
      settings.gstNumber = String(gstNumber || "").trim();
    }
    if (maintenanceMode !== undefined) {
      settings.maintenanceMode = toBoolean(maintenanceMode, false);
    }
    if (allowCOD !== undefined || allowCod !== undefined) {
      settings.allowCOD = toBoolean(
        allowCOD !== undefined ? allowCOD : allowCod,
        true,
      );
    }
    if (allowPartial !== undefined) {
      settings.allowPartial = toBoolean(allowPartial, false);
    }
    if (partialPaymentType !== undefined) {
      settings.partialPaymentType = normalizePartialPaymentType(
        partialPaymentType,
        settings.partialPaymentType || "PERCENT",
      );
    }
    if (partialPaymentValue !== undefined) {
      const normalizedPartialPaymentValue = Number(partialPaymentValue);
      settings.partialPaymentValue = Number.isNaN(normalizedPartialPaymentValue)
        ? settings.partialPaymentValue
        : normalizedPartialPaymentValue;
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
    applyNoStoreHeaders(res);

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
  getPublicSettings,
  updateSettings,
};
