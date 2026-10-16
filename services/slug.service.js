const slugify = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isSlugTaken = async (Model, slug, excludeId = null) =>
  Boolean(
    await Model.exists({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }),
  );

// Builds a unique slug from any text, appending -2, -3... when it is already in use.
const generateUniqueSlug = async (Model, value, excludeId = null) => {
  const baseSlug = slugify(value) || "product";
  let slug = baseSlug;
  let suffix = 2;

  while (await isSlugTaken(Model, slug, excludeId)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

module.exports = { slugify, isSlugTaken, generateUniqueSlug };
