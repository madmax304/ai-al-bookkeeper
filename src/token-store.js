/**
 * Simple file-based token store for Plaid access tokens.
 *
 * Stores linked accounts as:
 * {
 *   "company-name": {
 *     "chase-checking": {
 *       "access_token": "access-sandbox-...",
 *       "item_id": "...",
 *       "institution": "Chase",
 *       "accounts": [...],
 *       "cursor": null   // for transactions/sync pagination
 *     }
 *   }
 * }
 *
 * For production, swap this out for encrypted storage or a secret manager.
 */
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "tokens.json");

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(STORE_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
}

function save(data) {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function addAccount(company, label, tokenData) {
  const store = load();
  if (!store[company]) store[company] = {};
  store[company][label] = {
    ...tokenData,
    cursor: null, // sync cursor starts null (pulls all available history)
    linked_at: new Date().toISOString(),
  };
  save(store);
  console.log(`Saved account "${label}" for company "${company}"`);
}

function getCompanies() {
  return Object.keys(load());
}

function getAccounts(company) {
  const store = load();
  return store[company] || {};
}

function getAllAccounts() {
  return load();
}

function updateCursor(company, label, cursor) {
  const store = load();
  if (store[company] && store[company][label]) {
    store[company][label].cursor = cursor;
    save(store);
  }
}

module.exports = {
  addAccount,
  getCompanies,
  getAccounts,
  getAllAccounts,
  updateCursor,
};
