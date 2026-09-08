const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Lead = require("../models/lead.model");

function setup() {
  let records = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (value.$in) return value.$in.includes(row[key]);
      if (value.$lte) return row[key] <= value.$lte;
      if (value.$gt !== undefined) return row[key] > value.$gt;
    }
    return value === null ? row[key] == null : row[key] === value;
  });
  const model = {
    async deleteMany(filter) {
      records = records.filter((row) => !matches(row, filter));
    },
    async findOneAndUpdate(filter, update) {
      let row = records.find((record) => matches(record, filter));
      if (!row) {
        row = Object.fromEntries(Object.entries(filter).filter(([, value]) => value === null || typeof value !== "object"));
        records.push(row);
      }
      Object.assign(row, update.$set);
      const error = new Lead(row).validateSync();
      if (error) throw error;
      return row;
    },
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const row of records) {
        if (matches(row, filter)) { Object.assign(row, update.$set); modifiedCount++; }
      }
      return { modifiedCount };
    },
  };
  const context = { module: { exports: {} }, require: (name) => name === "../models/lead.model" ? model : require(name), Date };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/lead.service"), "utf8"), context);
  return { ...context.module.exports, records: () => records };
}

const user = { _id: "507f1f77bcf86cd799439011", phone: "919876543210", fullName: "Test Customer" };
const items = [{ product: { _id: "507f1f77bcf86cd799439012", name: "Product" }, name: "Product", price: 500, discountprice: 300, quantity: 2 }];

test("app product objects become valid snapshots at the discounted cart value", async () => {
  const service = setup();
  const lead = await service.syncUserCartLead({ user, items, source: "app" });
  assert.equal(lead.orderValue, 600);
  assert.equal(lead.cartItems[0].product, items[0].product._id);
  assert.equal(lead.contact, "9876543210");
});

test("only stale carts abandon; resuming updates the same record; clear removes it", async () => {
  const service = setup();
  const lead = await service.syncUserCartLead({ user, items });
  assert.equal((await service.markStaleCartsAbandoned()).modifiedCount, 0);
  lead.lastUpdatedCartOn = new Date(Date.now() - 61 * 60 * 1000);
  assert.equal((await service.markStaleCartsAbandoned()).modifiedCount, 1);
  assert.equal(lead.leadType, "ABANDONED_CART");
  assert.equal(await service.syncUserCartLead({ user, items }), lead);
  assert.equal(lead.leadType, "ACTIVE_CART");
  assert.equal(service.records().length, 1);
  await service.syncUserCartLead({ user, items: [] });
  assert.equal(service.records().length, 0);
});

test("guest carts are isolated and become a contactable cart on sign-in", async () => {
  const service = setup();
  const first = "a".repeat(64), second = "b".repeat(64);
  await service.syncUserCartLead({ guestCartToken: first, items });
  await service.syncUserCartLead({ guestCartToken: second, items });
  assert.equal(service.records().length, 2);
  assert.equal(service.records()[0].contact, "");
  assert.notEqual(service.records()[0].guestCartHash, first);
  await service.syncUserCartLead({ user, guestCartToken: first, items });
  assert.equal(service.records().length, 2);
  assert.equal(service.records().filter((lead) => lead.user === user._id).length, 1);
  await service.markCartConverted({ userId: user._id });
  assert.equal(service.records().length, 1);
  await service.syncUserCartLead({ guestCartToken: second, items: [] });
  assert.equal(service.records().length, 0);
});

test("invalid identity cannot modify carts and invalid inactivity uses 60 minutes", async () => {
  const service = setup();
  await assert.rejects(service.syncUserCartLead({ items }), /identity/);
  const lead = await service.syncUserCartLead({ user, items });
  lead.lastUpdatedCartOn = new Date(Date.now() - 30 * 60 * 1000);
  for (const value of [-1, 0, Infinity, "invalid"]) {
    assert.equal((await service.markStaleCartsAbandoned(value)).modifiedCount, 0);
  }
});

test("zero quantities clear the cart rather than inventing one item", async () => {
  const service = setup();
  await service.syncUserCartLead({ user, items });
  await service.syncUserCartLead({ user, items: [{ ...items[0], quantity: 0 }] });
  assert.equal(service.records().length, 0);
});
