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

leadRouter.post("/cart/sync", isAuth, syncCartLead);
leadRouter.post("/cart/clear", isAuth, clearCartLead);
leadRouter.post("/whatsapp", createWhatsAppLeadController);

leadRouter.get("/", isAdminAuth, getLeads);
leadRouter.post("/abandon-stale-carts", isAdminAuth, abandonStaleCartLeads);

module.exports = { leadRouter };
