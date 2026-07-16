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
const Order = require("../models/order.model");
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

    const orderStats = await Order.aggregate([
      {
        $group: {
          _id: "$user",
          orderCount: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ["$totalPrice", 0] } },
        },
      },
    ]);

    const statsMap = new Map(
      orderStats.map((item) => [
        String(item._id),
        {
          orderCount: Number(item.orderCount || 0),
          totalSpent: Number(item.totalSpent || 0),
        },
      ]),
    );

    const customers = users
      .map((user) => {
        const stats = statsMap.get(String(user._id)) || {};

        return {
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
          orderCount: stats.orderCount || 0,
          totalSpent: stats.totalSpent || 0,
        };
      })
      .sort((first, second) => {
        const orderDelta = Number(second.orderCount || 0) - Number(first.orderCount || 0);

        if (orderDelta !== 0) {
          return orderDelta;
        }

        return new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
      });

    return res.status(200).json({
      success: true,
      count: customers.length,
      data: customers,
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

const promoteManualReward = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { customerId } = req.params;
    const { points, note } = req.body;
    const normalizedPoints = Number(points);

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer id",
      });
    }

    if (!Number.isFinite(normalizedPoints) || normalizedPoints <= 0) {
      return res.status(400).json({
        success: false,
        message: "Reward points must be greater than 0",
      });
    }

    session.startTransaction();

    const user = await User.findById(customerId).session(session);

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const [transaction] = await WalletTransaction.create(
      [
        {
          user: user._id,
          type: "ADJUSTMENT",
          amount: 0,
          points: normalizedPoints,
          note:
            String(note || "").trim() ||
            "Manual reward promotion by admin",
          status: "SETTLED",
        },
      ],
      { session },
    );

    user.rewardPoints = Number(user.rewardPoints || 0) + normalizedPoints;
    await user.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Reward promoted successfully",
      data: {
        transaction: transaction
          ? {
              _id: transaction._id,
              type: transaction.type,
              amount: transaction.amount,
              points: transaction.points,
              note: transaction.note,
              status: transaction.status,
              createdAt: transaction.createdAt,
              user: {
                _id: user._id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
              },
            }
          : null,
        wallet: {
          walletBalance: Number(user.walletBalance || 0),
          rewardPoints: Number(user.rewardPoints || 0),
        },
      },
    });
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    console.error("Error promoting manual reward:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while promoting reward",
      error: error.message,
    });
  } finally {
    session.endSession();
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
                orderAmount: tx.sourceOrder.totalPrice,
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

const updateRewardTransaction = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { transactionId } = req.params;
    const { points } = req.body;
    const normalizedPoints = Number(points);

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reward transaction id",
      });
    }

    if (!Number.isFinite(normalizedPoints) || normalizedPoints < 0) {
      return res.status(400).json({
        success: false,
        message: "Points must be a valid non-negative number",
      });
    }

    session.startTransaction();

    const transaction = await WalletTransaction.findById(transactionId).session(
      session,
    );

    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Reward transaction not found",
      });
    }

    if (transaction.type !== "ORDER_REWARD") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Only order reward entries can be modified",
      });
    }

    const user = await User.findById(transaction.user).session(session);

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentPoints = Number(transaction.points || 0);
    const pointDelta = Number((normalizedPoints - currentPoints).toFixed(2));
    const nextRewardPoints = Number(user.rewardPoints || 0) + pointDelta;

    if (nextRewardPoints < 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Updated reward points cannot make user balance negative",
      });
    }

    transaction.points = normalizedPoints;
    transaction.note = "Order reward updated by admin";
    await transaction.save({ session });

    user.rewardPoints = nextRewardPoints;
    await user.save({ session });

    await session.commitTransaction();

    const refreshedTransaction = await WalletTransaction.findById(transactionId)
      .populate("user", "fullName email phone")
      .populate("sourceOrder", "_id orderNumber totalPrice amountPaid paymentMode")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Reward updated successfully",
      data: {
        transaction: refreshedTransaction
          ? {
              ...refreshedTransaction,
              sourceOrder: refreshedTransaction.sourceOrder
                ? {
                    ...refreshedTransaction.sourceOrder,
                    orderAmount: refreshedTransaction.sourceOrder.totalPrice,
                  }
                : null,
            }
          : null,
        rewardPoints: user.rewardPoints,
      },
    });
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    console.error("Error updating reward transaction:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating reward transaction",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  loginAdmin,
  getOwnerAdmin,
  sendManualNotification,
  getNotificationRecipients,
  getCustomers,
  getRewards,
  promoteManualReward,
  updateRewardTransaction,
};
