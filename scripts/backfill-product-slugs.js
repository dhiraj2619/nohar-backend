require("dotenv").config();
const mongoose = require("mongoose");

const connectTodb = require("../dbconnection");
const Product = require("../models/products.model");
const { generateUniqueSlug } = require("../services/slug.service");

const run = async () => {
  await connectTodb();
  await Product.syncIndexes();

  const products = await Product.find({
    $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
  })
    .select("_id name")
    .sort({ createdAt: 1 })
    .lean();

  for (const product of products) {
    const slug = await generateUniqueSlug(Product, product.name, product._id);
    await Product.updateOne({ _id: product._id }, { $set: { slug } });
    console.log(`${product._id} -> ${slug}`);
  }

  console.log(`Slug backfill complete. Updated ${products.length} products.`);
};

run()
  .catch((error) => {
    console.error("Slug backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
