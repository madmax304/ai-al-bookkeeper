/**
 * Transaction sync (single-company: natal).
 *
 * Pulls added/modified/removed transactions from each linked Plaid item via
 * /transactions/sync, runs the vendor-map categorizer for a pre-fill, and
 * upserts into the configured Google Sheet.
 *
 *   npm run sync             # sync all linked accounts
 *   node src/sync.js chase   # sync one account label
 */
const { plaidClient } = require("./plaid-client");
const tokenStore = require("./token-store");
const { categorizeAll, DEFAULT_VENDORS } = require("./categorizer");
const { upsertTransactions, readVendorMap } = require("./sheets");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

async function syncAccount(label, accountData) {
  const { access_token, cursor } = accountData;

  let added = [];
  let modified = [];
  let removed = [];
  let nextCursor = cursor;
  let hasMore = true;

  console.log(`  Syncing ${label}...`);

  while (hasMore) {
    const request = { access_token, ...(nextCursor ? { cursor: nextCursor } : {}) };
    const response = await plaidClient.transactionsSync(request);
    const data = response.data;
    added = added.concat(data.added);
    modified = modified.concat(data.modified);
    removed = removed.concat(data.removed);
    hasMore = data.has_more;
    nextCursor = data.next_cursor;
  }

  tokenStore.updateCursor(label, nextCursor);
  return { added, modified, removed };
}

function normalize(txn, label, institution) {
  return {
    id: txn.transaction_id,
    pending_transaction_id: txn.pending_transaction_id || null,
    date: txn.date,
    description: txn.name || txn.merchant_name || "Unknown",
    merchant: txn.merchant_name || null,
    amount: txn.amount,
    currency: txn.iso_currency_code || "USD",
    account_label: label,
    institution,
    plaid_category: txn.personal_finance_category?.primary || null,
    plaid_detailed: txn.personal_finance_category?.detailed || null,
    pending: txn.pending || false,
  };
}

async function syncAll(targetLabel) {
  const accounts = tokenStore.getAccounts();
  const labels = targetLabel ? [targetLabel] : Object.keys(accounts);

  if (labels.length === 0) {
    console.log("No accounts linked. Open http://localhost:3000 to connect.");
    return { added: [], modified: [], removed: [] };
  }

  const allAdded = [];
  const allModified = [];
  const allRemoved = [];

  for (const label of labels) {
    if (!accounts[label]) {
      console.log(`Account "${label}" not linked. Skipping.`);
      continue;
    }
    try {
      const r = await syncAccount(label, accounts[label]);
      const inst = accounts[label].institution;
      allAdded.push(...r.added.map((t) => normalize(t, label, inst)));
      allModified.push(...r.modified.map((t) => normalize(t, label, inst)));
      allRemoved.push(...r.removed);
      console.log(`    +${r.added.length} / ~${r.modified.length} / -${r.removed.length}`);
    } catch (err) {
      console.error(`  Error syncing ${label}:`, err.response?.data || err.message);
    }
  }

  const spreadsheetId = process.env.NATAL_SHEET_ID;
  if (!spreadsheetId) {
    console.error("\nNATAL_SHEET_ID not set in .env.local — skipping sheet write.");
    return { added: allAdded, modified: allModified, removed: allRemoved };
  }

  const sheetVendorMap = await readVendorMap(spreadsheetId);
  const vendorMap = sheetVendorMap
    ? { ...DEFAULT_VENDORS, ...sheetVendorMap }
    : DEFAULT_VENDORS;
  if (sheetVendorMap) {
    console.log(`  Vendor map: ${Object.keys(sheetVendorMap).length} entries from sheet`);
  }

  const combined = categorizeAll([...allAdded, ...allModified], vendorMap);

  await upsertTransactions(spreadsheetId, combined, allRemoved);

  const uncat = combined.filter((t) => !t.category || t.category === "Uncategorized");
  console.log(`\n  Total: ${combined.length} new/modified (${uncat.length} uncategorized)`);

  return { added: allAdded, modified: allModified, removed: allRemoved };
}

if (require.main === module) {
  const label = process.argv[2] || null;
  console.log("=================================");
  console.log("  Natal Bookkeeper — Sync");
  console.log("=================================");
  syncAll(label)
    .then(() => console.log("\n--- Done ---\n"))
    .catch((err) => {
      console.error("Sync failed:", err.response?.data || err);
      process.exit(1);
    });
}

module.exports = { syncAll };
