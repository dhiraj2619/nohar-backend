const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_JWT_SECRET,
  ADMIN_NAME,
} = require("../config/config");
const User = require("../models/users.model");
const WalletTransaction = require("../models/walletTransaction.model");
const AdminInfo = require("../models/adminInfo.model");
const { sendPushToUsers } = require("../services/notification.service");

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
      { expiresIn: "7d" },
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

const normalizeStringArray = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);

const normalizeObjectIdArray = (value) =>
  normalizeStringArray(value).filter((id) => mongoose.Types.ObjectId.isValid(id));

const pushTokenQuery = {
  $exists: true,
  $type: "string",
  $regex: /\S/,
};

const buildManualNotificationQuery = ({ audience, userIds, phoneNumbers }) => {
  const normalizedAudience = String(audience || "all").trim().toLowerCase();

  if (normalizedAudience === "all") {
    return { fcmToken: pushTokenQuery };
  }

  if (normalizedAudience === "users") {
    const normalizedUserIds = normalizeObjectIdArray(userIds);

    if (!normalizedUserIds.length) {
      return null;
    }

    return {
      _id: { $in: normalizedUserIds },
      fcmToken: pushTokenQuery,
    };
  }

  if (normalizedAudience === "phones") {
    const normalizedPhones = normalizeStringArray(phoneNumbers);

    if (!normalizedPhones.length) {
      return null;
    }

    return {
      phone: { $in: normalizedPhones },
      fcmToken: pushTokenQuery,
    };
  }

  return undefined;
};

const sendManualNotification = async (req, res) => {
  try {
    const { title, body, audience = "all", userIds, phoneNumbers, data, imageUrl } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "Title and body are required",
      });
    }

    const query = buildManualNotificationQuery({ audience, userIds, phoneNumbers });

    if (query === undefined) {
      return res.status(400).json({
        success: false,
        message: "Invalid audience. Use all, users, or phones",
      });
    }

    if (query === null) {
      return res.status(400).json({
        success: false,
        message: "Recipients are required for the selected audience",
      });
    }

    const recipients = await User.find(query).select("_id phone fullName fcmToken");

    if (!recipients.length) {
      return res.status(404).json({
        success: false,
        message: "No users with registered FCM tokens were found for this audience",
      });
    }

    const deliveryResult = await sendPushToUsers({
      users: recipients,
      title,
      body,
      data: {
        type: "ADMIN_BROADCAST",
        audience,
        ...data,
      },
      imageUrl,
    });

    return res.status(200).json({
      success: true,
      message: "Notification processed",
      audience,
      recipientCount: recipients.length,
      ...deliveryResult,
    });
  } catch (error) {
    console.error("Send manual notification error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error.message,
    });
  }
};

const getNotificationRecipients = async (req, res) => {
  try {
    const users = await User.find({ fcmToken: pushTokenQuery })
      .select("_id fullName phone email fcmToken")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      users: users.map((user) => ({
        _id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        hasFcmToken: Boolean(String(user.fcmToken || "").trim()),
      })),
    });
  } catch (error) {
    console.error("Get notification recipients error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification recipients",
      error: error.message,
    });
  }
};

const getCustomers = async (req, res) => {
  try {
    const users = await User.find()
      .select(
        "_id fullName email phone isActive fcmToken signupBonusGranted createdAt updatedAt",
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users.map((user) => ({
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        hasFcmToken: Boolean(String(user.fcmToken || "").trim()),
        signupBonusGranted: Boolean(user.signupBonusGranted),
        welcomeBonusGranted: Boolean(user.signupBonusGranted),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching customers",
      error: error.message,
    });
  }
};

const getRewards = async (req, res) => {
  try {
    const settings = await AdminInfo.findOne()
      .select("newCustomerWelcomeBonus orderRewardDefault updatedAt createdAt")
      .lean();

    const transactions = await WalletTransaction.find({
      type: { $in: ["SIGNUP_BONUS", "ORDER_REWARD", "REDEEM", "EXPIRE", "ADJUSTMENT"] },
    })
      .populate("user", "fullName email phone")
      .populate("sourceOrder", "_id orderNumber totalPrice amountPaid paymentMode")
      .sort({ createdAt: -1 })
      .limit(250)
      .lean();

    const summary = transactions.reduce(
      (acc, tx) => {
        acc.totalTransactions += 1;
        if (tx.type === "SIGNUP_BONUS") acc.signupBonuses += 1;
        if (tx.type === "ORDER_REWARD") acc.orderRewards += 1;
        if (tx.type === "REDEEM") acc.redeems += 1;
        acc.totalAmount += Number(tx.amount || 0);
        acc.totalPoints += Number(tx.points || 0);
        return acc;
      },
      {
        totalTransactions: 0,
        signupBonuses: 0,
        orderRewards: 0,
        redeems: 0,
        totalAmount: 0,
        totalPoints: 0,
      },
    );

    return res.status(200).json({
      success: true,
      data: {
        settings: {
          newCustomerWelcomeBonus: Number(settings?.newCustomerWelcomeBonus ?? 50),
          orderRewardDefault: Number(settings?.orderRewardDefault ?? 2),
          updatedAt: settings?.updatedAt || settings?.createdAt || null,
        },
        summary,
        transactions: transactions.map((tx) => ({
          _id: tx._id,
          type: tx.type,
          amount: tx.amount,
          points: tx.points,
          note: tx.note,
          status: tx.status,
          expiresAt: tx.expiresAt,
          createdAt: tx.createdAt,
          user: tx.user
            ? {
                _id: tx.user._id,
                fullName: tx.user.fullName,
                email: tx.user.email,
                phone: tx.user.phone,
              }
            : null,
          sourceOrder: tx.sourceOrder
            ? {
                _id: tx.sourceOrder._id,
                orderNumber: tx.sourceOrder.orderNumber,
                totalPrice: tx.sourceOrder.totalPrice,
                amountPaid: tx.sourceOrder.amountPaid,
                paymentMode: tx.sourceOrder.paymentMode,
              }
            : null,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching rewards:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching rewards",
      error: error.message,
    });
  }
};

module.exports = {
  loginAdmin,
  getOwnerAdmin,
  sendManualNotification,
  getNotificationRecipients,
  getCustomers,
  getRewards,
};
