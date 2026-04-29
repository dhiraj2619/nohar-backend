const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/config");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    loginType: {
      type: String,
      enum: ["otp"],
      default: "otp",
      required: true,
    },
    profileImage: {
      type: String,
      default: null,
    },
    fcmToken: {
      type: String,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    profileCompleted: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

userSchema.methods.getJWTtoken = function () {
  return jwt.sign({ id: this._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

userSchema.pre("save", function normalizeUserFields() {
  if (this.email === "" || this.email === null) this.email = undefined;
  if (this.fullName === "") this.fullName = null;
  if (this.phone) this.phone = this.phone.trim();
});

const User = mongoose.model("User", userSchema);

module.exports = User;
