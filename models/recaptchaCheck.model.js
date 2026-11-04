const mongoose = require("mongoose");

const RETENTION_SECONDS = 7 * 24 * 60 * 60;

const recaptchaCheckSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    allowed: {
      type: Boolean,
      required: true,
    },
    // True when Google scored the token, which is what Google bills for.
    assessed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

recaptchaCheckSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const RecaptchaCheck = mongoose.model("RecaptchaCheck", recaptchaCheckSchema);

module.exports = RecaptchaCheck;
