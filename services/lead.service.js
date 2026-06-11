const Lead = require("../models/lead.model");

const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const normalizeSource = (value) => {
  const source = String(value || "").trim().toLowerCase();

  return ["web", "app", "admin"].includes(source) ? source : "unknown";
};

const getCustomerName = (user, fallback = {}) =>
  user?.fullName || user?.name || fallback.customerName || fallback.fullName || "";

const getItemProduct = (item = {}) =>
  item.product || item.productId || item._id || item.id || null;

const getItemName = (item = {}) =>
  item.name ||
  item.productName ||
  item.title ||
  item.product?.name ||
  item.productId?.name ||
  "";

const getItemImage = (item = {}) => {
  const image =
    item.image ||
    item.thumbnail ||
    item.productImage ||
    item.product?.image ||
    item.product?.images?.[0] ||
    item.productId?.image ||
    item.productId?.images?.[0];

  if (!image) return "";

  return typeof image === "string" ? image : image.url || "";
};

const getItemPrice = (item = {}) => {
  const price = Number(item?.price || item?.finalPrice || item?.discountprice || 0);

  return Number.isNaN(price) ? 0 : price;
};

const getItemQuantity = (item = {}) => {
  const quantity = Number(item?.quantity || item?.qty || 1);

  return Number.isNaN(quantity) ? 1 : quantity;
};

const getCartItemSnapshots = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      product: getItemProduct(item),
      name: getItemName(item),
      image: getItemImage(item),
      quantity: getItemQuantity(item),
      price: getItemPrice(item),
    }))
    .filter((item) => item.name || item.product || item.price > 0);

const getOrderValue = (items = []) =>
  (Array.isArray(items) ? items : []).reduce((total, item) => {
    const price = getItemPrice(item);
    const quantity = getItemQuantity(item);

    if (Number.isNaN(price) || Number.isNaN(quantity)) {
      return total;
    }

    return total + price * quantity;
  }, 0);

const syncUserCartLead = async ({ user, items, source = "unknown" }) => {
  const orderValue = Number(getOrderValue(items).toFixed(2));
  const cartItems = getCartItemSnapshots(items);

  await Lead.deleteMany({
    user: user._id,
    leadType: "ABANDONED_CART",
  });

  if (!Array.isArray(items) || items.length === 0 || orderValue <= 0) {
    await Lead.deleteMany({
      user: user._id,
      leadType: "ACTIVE_CART",
    });

    return null;
  }

  return Lead.findOneAndUpdate(
    {
      user: user._id,
      leadType: "ACTIVE_CART",
    },
    {
      $set: {
        contact: normalizePhone(user.phone),
        customerName: getCustomerName(user),
        lastUpdatedCartOn: new Date(),
        orderValue,
        cartItems,
        source: normalizeSource(source),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );
};

const markStaleCartsAbandoned = async (inactiveMinutes = 60) => {
  const minutes = Number(inactiveMinutes);
  const cutoff = new Date(
    Date.now() - (Number.isNaN(minutes) ? 60 : minutes) * 60 * 1000,
  );

  const staleActiveCarts = await Lead.find({
    leadType: "ACTIVE_CART",
    lastUpdatedCartOn: { $lte: cutoff },
    orderValue: { $gt: 0 },
  });

  await Promise.all(
    staleActiveCarts.map(async (lead) => {
      await Lead.findOneAndUpdate(
        {
          user: lead.user,
          leadType: "ABANDONED_CART",
        },
        {
          $set: {
            contact: lead.contact,
            customerName: lead.customerName,
            lastUpdatedCartOn: lead.lastUpdatedCartOn,
            orderValue: lead.orderValue,
            cartItems: lead.cartItems,
            source: lead.source,
          },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        },
      );

      await Lead.deleteOne({ _id: lead._id });
    }),
  );

  return {
    cutoff,
    modifiedCount: staleActiveCarts.length,
  };
};

const markCartConverted = async ({ userId }) => {
  if (!userId) {
    return null;
  }

  return Lead.deleteMany({
    user: userId,
    leadType: { $in: ["ACTIVE_CART", "ABANDONED_CART"] },
  });
};

const createWhatsAppLead = async ({
  phone,
  message,
  source = "web",
}) => Lead.create({
  leadType: "WHATSAPP_LEAD",
  contact: normalizePhone(phone),
  enquiryCreatedOn: new Date(),
  enquiry: String(message || "").trim(),
  source: normalizeSource(source),
});

module.exports = {
  createWhatsAppLead,
  markCartConverted,
  markStaleCartsAbandoned,
  normalizePhone,
  syncUserCartLead,
};
