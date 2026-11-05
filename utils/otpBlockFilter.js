// `expiresAt: null` also matches blocks saved before the field existed, which
// never expire.
const activeBlockFilter = (now = new Date()) => ({
  isBlocked: true,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

const inactiveBlockFilter = (now = new Date()) => ({
  $or: [{ isBlocked: false }, { isBlocked: true, expiresAt: { $lte: now } }],
});

const isBlockActive = (block, now = new Date()) =>
  Boolean(block?.isBlocked && (!block.expiresAt || new Date(block.expiresAt) > now));

module.exports = {
  activeBlockFilter,
  inactiveBlockFilter,
  isBlockActive,
};
