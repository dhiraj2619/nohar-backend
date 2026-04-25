const {
  getOwnerAdmin,
  getCustomers,
  loginAdmin,
  sendManualNotification,
  getNotificationRecipients,
} = require("../controllers/admin.controller");
const {
  createAd,
  deleteAd,
  getAds,
  updateAd,
} = require("../controllers/ad.controller");
const {
  getSettings,
  updateSettings,
} = require("../controllers/settings.controller");
const {
  advanceOrderPhase,
  getOrders,
  updateOrderStatus,
} = require("../controllers/order.controller");
const { updateMostBuyStatus } = require("../controllers/product.controller");
const upload = require("../config/multerConfig");
const { isAdminAuth } = require("../middlewares/auth.middleware");

const adminRouter = require("express").Router();

adminRouter.post("/login", loginAdmin);
adminRouter.get("/owner", getOwnerAdmin);
adminRouter.get("/customers", isAdminAuth, getCustomers);
adminRouter.get("/orders", isAdminAuth, getOrders);
adminRouter.patch("/orders/:orderId/next-phase", isAdminAuth, advanceOrderPhase);
adminRouter.patch("/orders/:orderId/status", isAdminAuth, updateOrderStatus);
adminRouter.patch("/products/:id/most-buy", isAdminAuth, updateMostBuyStatus);
adminRouter.get("/notifications/recipients", isAdminAuth, getNotificationRecipients);
adminRouter.post("/notifications/send", isAdminAuth, sendManualNotification);
adminRouter.get("/settings", isAdminAuth, getSettings);
adminRouter.put("/settings", isAdminAuth, updateSettings);
adminRouter.get("/ads", isAdminAuth, getAds);
adminRouter.post("/ads", isAdminAuth, upload.single("image"), createAd);
adminRouter.put("/ads/:id", isAdminAuth, upload.single("image"), updateAd);
adminRouter.delete("/ads/:id", isAdminAuth, deleteAd);

module.exports = { adminRouter };
