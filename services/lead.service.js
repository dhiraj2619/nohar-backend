const Lead = require("../models/lead.model");
const { createHash } = require("node:crypto");

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

const getItemProduct = (item = {}) => {
  const product = item.product || item.productId || item._id || item.id;
  return product && typeof product === "object"
    ? product._id || product.id || null
    : product || null;
};

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
  const price = Number(item?.finalPrice ?? item?.discountprice ?? item?.price ?? 0);

  return Number.isFinite(price) ? Math.max(price, 0) : 0;
};

const getItemQuantity = (item = {}) => {
  const quantity = Number(item?.quantity ?? item?.qty ?? 1);

  return Number.isFinite(quantity) ? Math.max(quantity, 0) : 0;
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

const syncUserCartLead = async ({ user, guestCartToken, items, source = "unknown" }) => {
  const guestCartHash = /^[a-f0-9]{64}$/i.test(String(guestCartToken || ""))
    ? createHash("sha256").update(guestCartToken).digest("hex")
    : null;
  if (!user?._id && !guestCartHash) throw new Error("Cart identity is required");
  const identity = user?._id ? { user: user._id } : { guestCartHash, user: null };
  const clearMergedGuest = async () => {
    if (user?._id && guestCartHash) {
      await Lead.deleteMany({ guestCartHash, user: null, leadType: { $in: ["ACTIVE_CART", "ABANDONED_CART"] } });
    }
  };
  const orderValue = Number(getOrderValue(items).toFixed(2));
  const cartItems = getCartItemSnapshots(items);

  if (!Array.isArray(items) || items.length === 0 || orderValue <= 0) {
    await Lead.deleteMany({
      ...identity,
      leadType: { $in: ["ACTIVE_CART", "ABANDONED_CART"] },
    });
    await clearMergedGuest();

    return null;
  }

  const lead = await Lead.findOneAndUpdate(
    {
      ...identity,
      leadType: { $in: ["ACTIVE_CART", "ABANDONED_CART"] },
    },
    {
      $set: {
        leadType: "ACTIVE_CART",
        contact: normalizePhone(user?.phone),
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
  // Remove the anonymous copy only after the customer's cart saved successfully.
  await clearMergedGuest();
  return lead;
};

const markStaleCartsAbandoned = async (inactiveMinutes = 60) => {
  const minutes = Number(inactiveMinutes);
  const cutoff = new Date(
    Date.now() - (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000,
  );

  const result = await Lead.updateMany({
    leadType: "ACTIVE_CART",
    lastUpdatedCartOn: { $lte: cutoff },
    orderValue: { $gt: 0 },
  }, { $set: { leadType: "ABANDONED_CART" } });

  return {
    cutoff,
    modifiedCount: result.modifiedCount,
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
