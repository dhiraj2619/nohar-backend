const upload = require("../config/multerConfig");
const {
  createProduct,
  updateProduct,
  getProductsBycollections,
  getProductsByCategories,
  getProductById,
  getAllProducts,
} = require("../controllers/product.controller");

const productRouter = require("express").Router();

productRouter.post(
  "/add",
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "guideImage", maxCount: 1 },
  ]),
  createProduct,
);
productRouter.put(
  "/update/:id",
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "guideImage", maxCount: 1 },
  ]),
  updateProduct,
);
productRouter.get("/get-by-collection/:collectionId", getProductsBycollections);
productRouter.get("/get-by-category/:categoryId", getProductsByCategories);
productRouter.get("/get-by-id/:id", getProductById);
productRouter.get("/get-all", getAllProducts);

module.exports = { productRouter };
