const {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} = require("../controllers/category.controller");

const categoryRouter = require("express").Router();

categoryRouter.post("/add", createCategory);
categoryRouter.get("/get-all", getAllCategories);
categoryRouter.get("/get-by-id/:id", getCategoryById);
categoryRouter.put("/update/:id", updateCategory);
categoryRouter.delete("/delete/:id", deleteCategory);

module.exports = { categoryRouter };
