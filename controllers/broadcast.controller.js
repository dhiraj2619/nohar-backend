const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const Broadcast = require("../models/broadcast.model");

const validateFields = (body, partial = false) => {
  const fields = {};
  for (const [key, max] of [["title", 200], ["description", 5000]]) {
    if (partial && body[key] === undefined) continue;
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > max) {
      throw Object.assign(new Error(`${key} is required and must be at most ${max} characters`), { status: 400 });
    }
    fields[key] = body[key].trim();
  }
  if (!partial || body.url !== undefined) {
    if (body.url !== undefined && typeof body.url !== "string") {
      throw Object.assign(new Error("URL must be a valid HTTP or HTTPS link"), { status: 400 });
    }
    fields.url = (body.url || "").trim();
    if (fields.url) {
      let valid = false;
      try {
        const url = new URL(fields.url);
        valid = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && fields.url.length <= 2048;
      } catch { /* handled below */ }
      if (!valid) throw Object.assign(new Error("URL must be a valid HTTP or HTTPS link"), { status: 400 });
    }
  }
  return fields;
};

const uploadImage = (file) => new Promise((resolve, reject) => {
  cloudinary.uploader.upload_stream({ folder: "broadcasts/images", resource_type: "image", allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"] }, (error, result) => {
    if (error) return reject(error);
    resolve({ public_id: result.public_id, url: result.secure_url });
  }).end(file.buffer);
});

const removeImage = async (image) => {
  if (!image?.public_id) return;
  try { await cloudinary.uploader.destroy(image.public_id); }
  catch (error) { console.error("Broadcast image cleanup failed:", error.message); }
};

const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Broadcast operation failed" });
const findBroadcast = async (id) => {
  if (!mongoose.isObjectIdOrHexString(id)) throw Object.assign(new Error("Invalid broadcast ID"), { status: 400 });
  const broadcast = await Broadcast.findById(id);
  if (!broadcast) throw Object.assign(new Error("Broadcast not found"), { status: 404 });
  return broadcast;
};

const getBroadcasts = async (req, res) => {
  try {
    const data = await Broadcast.find().sort({ createdAt: -1, _id: -1 });
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error); }
};
const getBroadcast = async (req, res) => {
  try { return res.json({ success: true, data: await findBroadcast(req.params.id) }); }
  catch (error) { return fail(res, error); }
};
const createBroadcast = async (req, res) => {
  let image;
  try {
    const fields = validateFields(req.body || {});
    if (!req.file) throw Object.assign(new Error("Image is required"), { status: 400 });
    image = await uploadImage(req.file);
    const data = await Broadcast.create({ ...fields, image });
    return res.status(201).json({ success: true, message: "Broadcast created", data });
  } catch (error) { await removeImage(image); return fail(res, error); }
};
const updateBroadcast = async (req, res) => {
  let image;
  try {
    const fields = validateFields(req.body || {}, true);
    const data = await findBroadcast(req.params.id);
    const previousImage = { public_id: data.image?.public_id };
    if (req.file) image = await uploadImage(req.file);
    Object.assign(data, fields, image ? { image } : {});
    await data.save();
    if (image) await removeImage(previousImage);
    return res.json({ success: true, message: "Broadcast updated", data });
  } catch (error) { await removeImage(image); return fail(res, error); }
};
const deleteBroadcast = async (req, res) => {
  try {
    const data = await findBroadcast(req.params.id);
    await data.deleteOne();
    await removeImage(data.image);
    return res.json({ success: true, message: "Broadcast deleted" });
  } catch (error) { return fail(res, error); }
};

module.exports = { getBroadcasts, getBroadcast, createBroadcast, updateBroadcast, deleteBroadcast };
