const {
  getOwnerAdmin,
  loginAdmin,
  sendManualNotification,
  getNotificationRecipients,
} = require("../controllers/admin.controller");
const {
  advanceOrderPhase,
  getOrders,
  updateOrderStatus,
} = require("../controllers/order.controller");
const { isAdminAuth } = require("../middlewares/auth.middleware");

const adminRouter = require("express").Router();

adminRouter.post("/login", loginAdmin);
adminRouter.get("/owner", getOwnerAdmin);
adminRouter.get("/orders", isAdminAuth, getOrders);
adminRouter.patch("/orders/:orderId/next-phase", isAdminAuth, advanceOrderPhase);
adminRouter.patch("/orders/:orderId/status", isAdminAuth, updateOrderStatus);
adminRouter.get("/notifications/recipients", isAdminAuth, getNotificationRecipients);
adminRouter.post("/notifications/send", isAdminAuth, sendManualNotification);

module.exports = { adminRouter };
