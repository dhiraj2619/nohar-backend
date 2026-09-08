const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const mongoose = require("mongoose");
const Broadcast = require("../models/broadcast.model");

function setup() {
  const removed = [];
  let saved, failSave = false, uploads = 0;
  const model = {
    find() { return { sort: async () => saved ? [saved] : [] }; },
    async findById() { return saved; },
    async create(fields) {
      if (failSave) throw new Error("Database unavailable");
      saved = new Broadcast(fields);
      await saved.validate();
      saved.save = async () => { if (failSave) throw new Error("Database unavailable"); await saved.validate(); };
      saved.deleteOne = async () => { saved = null; };
      return saved;
    },
  };
  const cloudinary = { v2: { uploader: {
    upload_stream(options, callback) { return { end() { uploads++; callback(null, { public_id: `image-${uploads}`, secure_url: `https://images.example/${uploads}.png` }); } }; },
    async destroy(id) { removed.push(id); },
  } } };
  const context = { module: { exports: {} }, URL, console, require: (name) => name === "mongoose" ? mongoose : name === "cloudinary" ? cloudinary : model };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/broadcast.controller"), "utf8"), context);
  const call = async (method, req = {}) => {
    let status = 200, body;
    const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await context.module.exports[method](req, res);
    return { status, body };
  };
  return { call, removed, fail: () => { failSave = true; }, uploads: () => uploads };
}
const request = { body: { title: " New offer ", description: "Offer details", url: "https://nohar.in/shop" }, file: { buffer: Buffer.from("mock") } };
const params = { id: "507f1f77bcf86cd799439011" };

test("broadcast create, list, read, edit, replace image and delete", async () => {
  const api = setup();
  let result = await api.call("createBroadcast", request);
  assert.equal(result.status, 201);
  assert.equal(result.body.data.title, "New offer");
  assert.equal((await api.call("getBroadcasts")).body.data.length, 1);
  assert.equal((await api.call("getBroadcast", { params })).status, 200);
  result = await api.call("updateBroadcast", { params, body: { title: "Updated", url: "" } });
  assert.equal(result.body.data.title, "Updated");
  assert.equal(result.body.data.url, "");
  assert.equal(result.body.data.image.public_id, "image-1");
  result = await api.call("updateBroadcast", { params, body: {}, file: request.file });
  assert.equal(result.body.data.image.public_id, "image-2");
  assert.deepEqual(api.removed, ["image-1"]);
  assert.equal((await api.call("deleteBroadcast", { params })).status, 200);
  assert.deepEqual(api.removed, ["image-1", "image-2"]);
  assert.equal((await api.call("getBroadcast", { params })).status, 404);
});

test("required fields, image, safe URLs and invalid IDs reject before upload", async () => {
  const api = setup();
  for (const body of [{}, { title: " ", description: "x" }, { title: "x", description: "" }, { title: "x", description: "x", url: "javascript:alert(1)" }, { title: "x", description: "x", url: "not a url" }]) {
    assert.equal((await api.call("createBroadcast", { body, file: request.file })).status, 400);
  }
  assert.equal((await api.call("createBroadcast", { body: request.body })).status, 400);
  assert.equal((await api.call("getBroadcast", { params: { id: "invalid" } })).status, 400);
  assert.equal(api.uploads(), 0);
});

test("new upload is cleaned up when persistence fails", async () => {
  const api = setup();
  api.fail();
  assert.equal((await api.call("createBroadcast", request)).status, 500);
  assert.deepEqual(api.removed, ["image-1"]);
});

test("failed image replacement preserves the old cloud image", async () => {
  const api = setup();
  await api.call("createBroadcast", request);
  api.fail();
  assert.equal((await api.call("updateBroadcast", { params, body: {}, file: request.file })).status, 500);
  assert.deepEqual(api.removed, ["image-2"]);
});
