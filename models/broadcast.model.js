const mongoose = require("mongoose");

const broadcastSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  image: {
    public_id: { type: String, required: true },
    url: { type: String, required: true },
  },
  url: { type: String, trim: true, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("Broadcast", broadcastSchema);
