/**
 * File-based Plaid token store.
 *
 * Single-company ("natal") keyed by label, e.g.
 * {
 *   "chase": { access_token, item_id, institution, accounts, cursor, linked_at },
 *   "amex":  { ... }
 * }
 */
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "tokens.json");

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

function save(data) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function addAccount(label, tokenData) {
  const store = load();
  store[label] = {
    ...tokenData,
    cursor: null,
    linked_at: new Date().toISOString(),
  };
  save(store);
  console.log(`Saved account "${label}"`);
}

function getAccounts() {
  return load();
}

function updateCursor(label, cursor) {
  const store = load();
  if (store[label]) {
    store[label].cursor = cursor;
    save(store);
  }
}

module.exports = { addAccount, getAccounts, updateCursor };
