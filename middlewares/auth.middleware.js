const { ADMIN_JWT_SECRET, JWT_SECRET } = require("../config/config");
const User = require("../models/users.model");
const jwt = require("jsonwebtoken");

const isAuth = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select("_id  email fullname");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user not found",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Not authorized, token failed",
    });
  }
};

const isAdminAuth = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no admin token",
      });
    }

    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);

    if (decoded?.role !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: admin access required",
      });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    console.error("Admin Auth Middleware Error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Not authorized, admin token failed",
    });
  }
};

module.exports = { isAuth, isAdminAuth };
