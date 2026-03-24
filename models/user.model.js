const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../utils/config");

const userSchema = new mongoose.Schema({
  fullname: {
    type: String,
    required: false,
  },
  email: {
    type: String,
    unique: true,
    required: false,
    sparse: true,
    default: undefined,
  },
  phone: {
    type: String,
    unique: true,
    sparse: true,
  },
  dob: {
    type: Date,
  },
  gender: {
    type: String,
  },
  city: {
    type: String,
    trim: true,
    default: "",
  },
  state: {
    type: String,
    trim: true,
    default: "",
  },
  profileCompleted: {
    type: Boolean,
    default: false,
  },
  loginType: {
    type: String,
    enum: ["otp", "google"],
    required: true,
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  otp: {
    type: String,
  },
  otpExpiresAt: {
    type: Date,
  },
  profileImage: {
    type: String,
    default: null,
  },
  fcmToken: {
    type: String,
    default: null,
  },
});

userSchema.methods.getJWTtoken = function () {
  return jwt.sign({ id: this._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const User = mongoose.model("User", userSchema);

module.exports = User;
