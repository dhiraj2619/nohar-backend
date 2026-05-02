require("dotenv").config();

const express = require("express");
const path = require("path");
const cloudinary = require("cloudinary");
const cookieparser = require("cookie-parser");
const cors = require("cors");

const {
  PORT,
  CLOUDINARY_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = require("./config/config");
const connectTodb = require("./dbconnection");
const { categoryRouter } = require("./routes/category.route");
const { collectionRouter } = require("./routes/collection.route");
const { productRouter } = require("./routes/products.route");
const { adminRouter } = require("./routes/admin.route");
const { adRouter } = require("./routes/ad.route");
const { offerRouter } = require("./routes/offer.route");
const { quoteSliderRouter } = require("./routes/quoteslider.route");
const { userRouter } = require("./routes/user.route");
const { shippingRouter } = require("./routes/shipping.route");
const { paymentRouter } = require("./routes/payment.route");
const orderRouter = require("./routes/order.route");
const { notificationRouter } = require("./routes/notification.route");
const { initializeFirebase } = require("./services/notification.service");

const app = express();
const port = PORT;

connectTodb();
initializeFirebase();

cloudinary.config({
  cloud_name: CLOUDINARY_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieparser());
app.use(cors());

app.get("/", (req, res) => {
  res.send(`<center><h1>Server is Started...</h1></center>`);
});

app.get("/privacy-policy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy-policy.html"));
});

app.get("/delete-account", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "delete-account.html"));
});

app.use("/api/v1/categories", categoryRouter);
app.use("/api/v1/collections", collectionRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/offers", offerRouter);
app.use("/api/v1/ads", adRouter);
app.use("/api/v1/quote-sliders", quoteSliderRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/shipping", shippingRouter);
app.use("/api/v1/payment", paymentRouter);
app.use("/api/v1/orders", orderRouter);

// admin routes
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/admin/notifications", notificationRouter);

app.listen(port, () => {
  console.log(`server is running on http://localhost:${port}`);
});
