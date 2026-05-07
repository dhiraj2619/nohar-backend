const { default: axios } = require("axios");

const PINCODE_FALLBACKS = {
  422011: {
    city: "Nashik",
    state: "Maharashtra",
    country: "India",
  },
};

const normalizePincode = (value) => String(value || "").replace(/\D/g, "");

const getPincodeLocation = async (req, res) => {
  const pincode = normalizePincode(req.params.pincode);

  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid 6 digit pincode",
    });
  }

  try {
    const { data } = await axios.get(
      `https://api.postalpincode.in/pincode/${pincode}`,
      { timeout: 8000 },
    );
    const postOffice = data?.[0]?.PostOffice?.[0];

    if (postOffice) {
      return res.status(200).json({
        success: true,
        location: {
          pincode,
          city: postOffice?.District || "",
          state: postOffice?.State || "",
          country: postOffice?.Country || "India",
        },
      });
    }
  } catch (error) {
    console.error("Pincode lookup provider error:", {
      pincode,
      message: error?.message,
      status: error?.response?.status,
    });
  }

  const fallbackLocation = PINCODE_FALLBACKS[pincode];

  if (fallbackLocation) {
    return res.status(200).json({
      success: true,
      source: "fallback",
      location: {
        pincode,
        ...fallbackLocation,
      },
    });
  }

  return res.status(404).json({
    success: false,
    message: "No location found for this pincode",
  });
};

module.exports = {
  getPincodeLocation,
};
