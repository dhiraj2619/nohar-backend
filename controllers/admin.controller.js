const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_JWT_SECRET,
  ADMIN_NAME,
} = require("../config/config");

const buildOwnerProfile = () => ({
  id: "owner-nohar-001",
  name: ADMIN_NAME || "Nohar Owner",
  email: ADMIN_EMAIL,
  role: "owner",
  isActive: true,
  permissions: ["all"],
});

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Admin credentials are not configured on server",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const configuredEmail = String(ADMIN_EMAIL).trim().toLowerCase();

    const passwordMatchedByPlain =
      String(password) === String(ADMIN_PASSWORD);
    const passwordMatchedByHash =
      String(ADMIN_PASSWORD).startsWith("$2") &&
      (await bcrypt.compare(String(password), String(ADMIN_PASSWORD)));

    if (
      normalizedEmail !== configuredEmail ||
      (!passwordMatchedByPlain && !passwordMatchedByHash)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const admin = buildOwnerProfile();
    const token = jwt.sign(
      { role: admin.role, email: admin.email, id: admin.id },
      ADMIN_JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      data: admin,
      token,
    });
  } catch (error) {
    console.error("Error logging in admin:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while logging in admin",
      error: error.message,
    });
  }
};

const getOwnerAdmin = async (req, res) => {
  try {
    if (!ADMIN_EMAIL) {
      return res.status(500).json({
        success: false,
        message: "Admin is not configured on server",
      });
    }

    const admin = buildOwnerProfile();

    return res.status(200).json({
      success: true,
      message: "Owner admin fetched successfully",
      data: admin,
    });
  } catch (error) {
    console.error("Error fetching owner admin:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching owner admin",
      error: error.message,
    });
  }
};

module.exports = {
  loginAdmin,
  getOwnerAdmin,
};
