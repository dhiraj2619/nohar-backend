const { default: axios } = require("axios");
const {
  OTP_API_KEY,
  OTP_CAMPAIGN,
  OTP_ROUTE,
  OTP_SENDER_ID,
  OTP_TEMPLATE_ID,
  OTP_PE_ID,
  ANDROID_APP_SIGNATURE,
} = require("../config/config");
const Otp = require("../models/otp.model");
const User = require("../models/users.model");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000);

const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    console.log("entered phone", phone);

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    const msg = `Dear Customer Your Nohar cosmetics login OTP is ${otp} It will expire in next 10 mins. Please do not share code with anyone.\r\n${ANDROID_APP_SIGNATURE}`;

    const url = `https://kutility.org/app/smsapi/index.php?key=${OTP_API_KEY}&campaign=${OTP_CAMPAIGN}&routeid=${OTP_ROUTE}&type=text&contacts=${phone}&senderid=${OTP_SENDER_ID}&msg=${encodeURIComponent(msg)}&template_id=${OTP_TEMPLATE_ID}&pe_id=${OTP_PE_ID}`;

    const response = await axios.get(url);

    if (!response?.data) {
      return res.status(502).json({
        success: false,
        message: "SMS vendor did not return a valid response",
      });
    }

    const normalizePhone = (phone) => phone.replace(/\D/g, "");

    const cleanPhone = normalizePhone(phone);

    await Otp.findOneAndUpdate(
      { phone: cleanPhone },
      { otp, otpExpiry },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    return res.json({
      success: true,
      message: "OTP sent successfully",
      vendorResponse: response.data,
    });
  } catch (error) {
    console.error("Send OTP Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to send OTP" });
  }
};

const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required",
      });
    }

    const normalizePhone = (phone) => phone.replace(/\D/g, "");
    const cleanPhone = normalizePhone(phone);

    const otpRecord = await Otp.findOne({ phone: cleanPhone });

    if (!otpRecord) {
      return res.status(404).json({
        success: false,
        message: "No OTP request found for this phone number",
      });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (otpRecord.otpExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired",
      });
    }

    await Otp.deleteOne({ phone: cleanPhone });

    let user = await User.findOne({ phone: cleanPhone });

    if (!user) {
      user = await User.create({
        phone: cleanPhone,
        loginType: "otp",
        isVerified: true,
        fullName: null,
        email: null,
        profileCompleted: false,
      });
    } else {
      user.isVerified = true;

      const hasProfile = user.fullName?.trim() && user.email?.trim();

      user.profileCompleted = Boolean(hasProfile);

      await user.save();
    }

    const token = user.getJWTtoken();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      user: {
        _id: user._id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        profileCompleted: user.profileCompleted,
      },
      token,
    });
  } catch (error) {
    console.error("Verify OTP Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify OTP" });
  }
};

const logoutUser = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "user logged out success",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

const completeUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const { firstname, lastname, email } = req.body;

    if (!firstname || !lastname || !email) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const fullName = `${firstname} ${lastname}`.trim();

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.fullName = fullName;
    user.email = email;
    user.profileCompleted = true;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile completed successfully",
      user: {
        _id: user._id,
        phone: user.phone,
        fullName: user.fullName,
        email: user.email,
        profileCompleted: user.profileCompleted,
      },
    });
  } catch (error) {
    console.error("Complete Profile Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to complete profile" });
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  logoutUser,
  completeUserProfile,
};
