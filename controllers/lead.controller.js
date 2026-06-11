const Lead = require("../models/lead.model");
const {
  createWhatsAppLead,
  markStaleCartsAbandoned,
  normalizePhone,
  syncUserCartLead,
} = require("../services/lead.service");

const allowedLeadTypes = [
  "ABANDONED_CART",
  "ACTIVE_CART",
  "SUBSCRIBER",
  "WHATSAPP_LEAD",
];

const getPagination = (query) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const syncCartLead = async (req, res) => {
  try {
    const lead = await syncUserCartLead({
      user: req.user,
      items: req.body?.items,
      source: req.body?.source || "web",
    });

    return res.status(200).json({
      success: true,
      message: lead ? "Active cart tracked successfully" : "Cart tracking cleared",
      data: lead,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to sync cart lead",
      error: error.message,
    });
  }
};

const clearCartLead = async (req, res) => {
  try {
    const lead = await syncUserCartLead({
      user: req.user,
      items: [],
      source: req.body?.source || "web",
    });

    return res.status(200).json({
      success: true,
      message: "Cart tracking cleared successfully",
      data: lead,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to clear cart lead",
      error: error.message,
    });
  }
};

const abandonStaleCartLeads = async (req, res) => {
  try {
    const result = await markStaleCartsAbandoned(
      req.body?.inactiveMinutes || req.query?.inactiveMinutes || 60,
    );

    return res.status(200).json({
      success: true,
      message: "Stale active carts moved to abandoned cart",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark abandoned carts",
      error: error.message,
    });
  }
};

const createWhatsAppLeadController = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);

    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10 digit mobile number",
      });
    }

    const lead = await createWhatsAppLead({
      phone,
      message: req.body?.message,
      source: req.body?.source || "web",
    });

    return res.status(201).json({
      success: true,
      message: "WhatsApp lead tracked successfully",
      data: lead,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to track WhatsApp lead",
      error: error.message,
    });
  }
};

const getLeads = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = {};

    if (req.query.leadType) {
      const leadType = String(req.query.leadType).trim().toUpperCase();

      if (allowedLeadTypes.includes(leadType)) {
        filter.leadType = leadType;
      }
    }

    if (req.query.search) {
      const search = String(req.query.search).trim();
      filter.$or = [
        { contact: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { enquiry: { $regex: search, $options: "i" } },
      ];
    }

    const sortField =
      filter.leadType === "WHATSAPP_LEAD" ? "enquiryCreatedOn" : "lastUpdatedCartOn";

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .select(
          "leadType contact customerName lastUpdatedCartOn orderValue cartItems enquiryCreatedOn enquiry source createdAt updatedAt",
        )
        .sort({ [sortField]: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Lead.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: leads,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leads",
      error: error.message,
    });
  }
};

module.exports = {
  abandonStaleCartLeads,
  clearCartLead,
  createWhatsAppLeadController,
  getLeads,
  syncCartLead,
};
