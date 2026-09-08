const express = require("express");
const {
  abandonStaleCartLeads,
  clearCartLead,
  createWhatsAppLeadController,
  getLeads,
  syncCartLead,
} = require("../controllers/lead.controller");
const { isAdminAuth, isAuth } = require("../middlewares/auth.middleware");

const leadRouter = express.Router();

// Guest cart tokens authorize only the holder's anonymous cart, never a user cart.
const cartAuth = (req, res, next) => {
  if (req.headers.authorization || req.cookies?.token) return isAuth(req, res, next);
  if (!/^[a-f0-9]{64}$/i.test(String(req.body?.guestCartToken || ""))) {
    return res.status(400).json({ success: false, message: "A valid guest cart token is required" });
  }
  return next();
};

leadRouter.post("/cart/sync", cartAuth, syncCartLead);
leadRouter.post("/cart/clear", cartAuth, clearCartLead);
leadRouter.post("/whatsapp", createWhatsAppLeadController);

leadRouter.get("/", isAdminAuth, getLeads);
leadRouter.post("/abandon-stale-carts", isAdminAuth, abandonStaleCartLeads);

module.exports = { leadRouter };
