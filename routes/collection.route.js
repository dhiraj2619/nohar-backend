const {
  createCollection,
  getAllCollections,
  updateCollection,
  deleteCollection,
} = require("../controllers/collection.controller");

const collectionRouter = require("express").Router();

collectionRouter.post("/add", createCollection);
collectionRouter.get("/get-all", getAllCollections);
collectionRouter.put("/update/:id", updateCollection);
collectionRouter.delete("/delete/:id", deleteCollection);

module.exports = { collectionRouter };
