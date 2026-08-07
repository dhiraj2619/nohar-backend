const {
  APP_LATEST_VERSION_CODE,
  APP_LATEST_VERSION_NAME,
  APP_FORCE_UPDATE,
  APP_PLAY_STORE_URL,
} = require("../config/config");

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return Boolean(value);
};

const getAppVersion = async (_req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        latestVersionCode: Number(APP_LATEST_VERSION_CODE || 0),
        latestVersionName: APP_LATEST_VERSION_NAME,
        forceUpdate: toBoolean(APP_FORCE_UPDATE, true),
        playStoreUrl: APP_PLAY_STORE_URL,
      },
    });
  } catch (error) {
    console.error("Get app version error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch app version",
      error: error.message,
    });
  }
};

module.exports = {
  getAppVersion,
};
