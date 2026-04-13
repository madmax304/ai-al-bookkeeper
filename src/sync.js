/**
 * Transaction Sync
 *
 * Pulls new transactions from all linked Plaid accounts using /transactions/sync.
 * Categorizes them and outputs a summary.
 *
 * Usage:
 *   npm run sync                    # sync all companies
 *   node src/sync.js CompanyName    # sync one company
 *
 * The sync is incremental — it uses a cursor to only pull new/changed
 * transactions since the last sync. First run pulls all available history.
 */
const { plaidClient } = require("./plaid-client");
const tokenStore = require("./token-store");
const { categorizeAll } = require("./categorizer");
const { writeTransactions, writeReviewQueue } = require("./sheets");
require("dotenv").config();

const SHEET_CONFIG_PATH = require("path").join(__dirname, "..", "data", "sheet-config.json");

function loadSheetConfig() {
  const fs = require("fs");
  if (!fs.existsSync(SHEET_CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(SHEET_CONFIG_PATH, "utf-8"));
}

/**
 * Sync transactions for a single Plaid item (one linked bank connection).
 * Uses /transactions/sync for incremental updates.
 */
async function syncAccount(company, label, accountData) {
  const { access_token, cursor } = accountData;

  let allAdded = [];
  let allModified = [];
  let allRemoved = [];
  let nextCursor = cursor;
  let hasMore = true;

  console.log(`  Syncing ${company} / ${label}...`);

  while (hasMore) {
    const request = {
      access_token,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };

    try {
      const response = await plaidClient.transactionsSync(request);
      const data = response.data;

      allAdded = allAdded.concat(data.added);
      allModified = allModified.concat(data.modified);
      allRemoved = allRemoved.concat(data.removed);

      hasMore = data.has_more;
      nextCursor = data.next_cursor;
    } catch (error) {
      console.error(`  Error syncing ${label}:`, error.response?.data || error.message);
      return { added: [], modified: [], removed: [], cursor: nextCursor };
    }
  }

  // Save the cursor for next time
  tokenStore.updateCursor(company, label, nextCursor);

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    cursor: nextCursor,
  };
}

/**
 * Normalize a Plaid transaction into our standard format.
 */
function normalizeTransaction(txn, company, label, institution) {
  return {
    id: txn.transaction_id,
    date: txn.date,
    description: txn.name || txn.merchant_name || "Unknown",
    merchant: txn.merchant_name || null,
    amount: txn.amount, // Plaid: positive = debit/spend, negative = credit/income
    currency: txn.iso_currency_code || "USD",
    account_label: label,
    institution: institution,
    company: company,
    plaid_category: txn.personal_finance_category?.primary || null,
    plaid_detailed: txn.personal_finance_category?.detailed || null,
    pending: txn.pending || false,
  };
}

/**
 * Sync all companies and accounts.
 * Returns a structured summary of all new/modified/removed transactions.
 */
async function syncAll(targetCompany) {
  const allAccounts = tokenStore.getAllAccounts();
  const companies = targetCompany ? [targetCompany] : Object.keys(allAccounts);

  const results = {};

  for (const company of companies) {
    if (!allAccounts[company]) {
      console.log(`Company "${company}" not found. Skipping.`);
      continue;
    }

    console.log(`\nSyncing company: ${company}`);
    results[company] = { added: [], modified: [], removed: [] };

    const accounts = allAccounts[company];
    for (const [label, accountData] of Object.entries(accounts)) {
      const syncResult = await syncAccount(company, label, accountData);

      // Normalize transactions
      const normalizedAdded = syncResult.added.map((txn) =>
        normalizeTransaction(txn, company, label, accountData.institution)
      );
      const normalizedModified = syncResult.modified.map((txn) =>
        normalizeTransaction(txn, company, label, accountData.institution)
      );

      results[company].added.push(...normalizedAdded);
      results[company].modified.push(...normalizedModified);
      results[company].removed.push(...syncResult.removed);
    }

    // Categorize new transactions
    results[company].added = categorizeAll(results[company].added);
    results[company].modified = categorizeAll(results[company].modified);

    // Summary
    const { added, modified, removed } = results[company];
    const uncategorized = added.filter((t) => t.category === "Uncategorized");

    console.log(`  ${added.length} new transactions`);
    console.log(`  ${modified.length} modified transactions`);
    console.log(`  ${removed.length} removed transactions`);
    console.log(`  ${uncategorized.length} need manual categorization`);

    if (uncategorized.length > 0) {
      console.log(`\n  Uncategorized transactions for ${company}:`);
      uncategorized.slice(0, 10).forEach((t) => {
        console.log(`    ${t.date}  ${t.amount > 0 ? "-" : "+"}$${Math.abs(t.amount).toFixed(2)}  ${t.description}`);
      });
      if (uncategorized.length > 10) {
        console.log(`    ... and ${uncategorized.length - 10} more`);
      }
    }
  }

  return results;
}

// CLI entry point
if (require.main === module) {
  const targetCompany = process.argv[2] || null;

  console.log("=================================");
  console.log("  Bookkeeper — Transaction Sync");
  console.log("=================================");

  syncAll(targetCompany)
    .then(async (results) => {
      console.log("\n--- Sync complete ---\n");

      // Print totals
      let totalAdded = 0;
      let totalUncategorized = 0;
      for (const [company, data] of Object.entries(results)) {
        totalAdded += data.added.length;
        totalUncategorized += data.added.filter((t) => t.category === "Uncategorized").length;
      }
      console.log(`Total new transactions: ${totalAdded}`);
      console.log(`Total needing review: ${totalUncategorized}`);

      // Save to local JSON for debugging
      const fs = require("fs");
      const path = require("path");
      const outDir = path.join(__dirname, "..", "data");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "last-sync.json"),
        JSON.stringify(results, null, 2)
      );
      console.log(`\nResults saved to data/last-sync.json`);

      // Write to Google Sheets
      const sheetConfig = loadSheetConfig();
      for (const [company, data] of Object.entries(results)) {
        if (!sheetConfig[company]) {
          console.log(`\n[Sheets] No sheet configured for "${company}". Run: node src/setup-sheet.js "${company}" "your-email@gmail.com"`);
          continue;
        }
        const spreadsheetId = sheetConfig[company].spreadsheetId;
        try {
          await writeTransactions(spreadsheetId, data.added);
          await writeReviewQueue(spreadsheetId, data.added);
          console.log(`[Sheets] ✓ Updated sheet for "${company}"`);
        } catch (err) {
          console.error(`[Sheets] Error writing to sheet for "${company}":`, err.message);
        }
      }
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}

module.exports = { syncAll };
