const upload = require("../config/multerConfig");
const {
  createCollection,
  getAllCollections,
  updateCollection,
  deleteCollection,
} = require("../controllers/collection.controller");

const collectionRouter = require("express").Router();

collectionRouter.post(
  "/add",
  upload.fields([{ name: "thumbnail", maxCount: 1 }]),
  createCollection,
);
collectionRouter.get("/get-all", getAllCollections);
collectionRouter.put(
  "/update/:id",
  upload.fields([{ name: "thumbnail", maxCount: 1 }]),
  updateCollection,
);
collectionRouter.delete("/delete/:id", deleteCollection);

module.exports = { collectionRouter };
