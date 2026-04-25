require("dotenv").config();
const mongoose = require("mongoose");

const connectTodb = require("../dbconnection");
const Product = require("../models/products.model");

const BATCH_SIZE = 500;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const calculateFinalPrice = (price = 0, gstRate = 0, gstIncluded = true) => {
  const normalizedPrice = toNumber(price, 0);
  const normalizedGstRate = toNumber(gstRate, 0);

  if (!gstIncluded) return normalizedPrice;

  return Number(
    (
      normalizedPrice +
      (normalizedPrice * normalizedGstRate) / 100
    ).toFixed(2),
  );
};

const run = async () => {
  await connectTodb();

  let processed = 0;
  let modified = 0;
  let operations = [];

  const cursor = Product.find().lean().cursor();

  for await (const product of cursor) {
    processed += 1;

    const price = toNumber(product.price, 0);
    const gstRate = toNumber(
      product.gstRate !== undefined ? product.gstRate : product.gst,
      0,
    );
    const gstIncluded =
      product.gstIncluded !== undefined ? Boolean(product.gstIncluded) : true;
    const discountprice = toNumber(
      product.discountprice !== undefined
        ? product.discountprice
        : product.offerprice,
      0,
    );
    const hsnCode =
      typeof product.hsnCode === "string" ? product.hsnCode.trim() : "";
    const finalPrice = calculateFinalPrice(price, gstRate, gstIncluded);

    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            hsnCode,
            gstRate,
            gstIncluded,
            discountprice,
            finalPrice,
          },
          $unset: {
            offerpercent: 1,
            offerprice: 1,
            gst: 1,
          },
        },
      },
    });

    if (operations.length >= BATCH_SIZE) {
      const result = await Product.bulkWrite(operations, { ordered: false });
      modified += result.modifiedCount || 0;
      operations = [];
    }
  }

  if (operations.length) {
    const result = await Product.bulkWrite(operations, { ordered: false });
    modified += result.modifiedCount || 0;
  }

  console.log(`Processed products: ${processed}`);
  console.log(`Modified products: ${modified}`);
};

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Migration failed:", error);
    await mongoose.connection.close();
    process.exit(1);
  });
