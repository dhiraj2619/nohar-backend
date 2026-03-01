require("dotenv").config();

const express = require("express");
const cloudinary = require("cloudinary");
const cookieparser = require("cookie-parser");
const cors = require("cors");

const { PORT } = require("./config/config");
const connectTodb = require("./dbconnection");
const { collectionRouter } = require("./routes/collection.route");

const app = express();
const port = PORT;

connectTodb();

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

app.use("/api/v1/collections", collectionRouter);

// admin routes
// app.use("/api/v1/admin", adminRouter);

app.listen(port, () => {
  console.log(`server is running on http://localhost:${port}`);
});
