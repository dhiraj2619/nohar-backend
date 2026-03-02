const {
  createProduct,
  updateProduct,
  getProductsBycollections,
  getProductsByCategories,
  getProductById,
} = require("../controllers/product.controller");

const productRouter = require("express").Router();

productRouter.post("/add", createProduct);
productRouter.put("/update/:id", updateProduct);
productRouter.get("/get-by-collection/:collectionId", getProductsBycollections);
productRouter.get("/get-by-category/:categoryId", getProductsByCategories);
productRouter.get("/get-by-id/:id", getProductById);

module.exports = { productRouter };
