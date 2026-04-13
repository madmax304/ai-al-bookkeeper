/**
 * Google Sheets Writer
 *
 * Writes categorized transactions to a Google Sheet for review in Cowork.
 *
 * Sheet structure:
 *   - "Transactions" tab:  all synced transactions (append-only)
 *   - "Review Queue" tab:  uncategorized items for manual categorization
 *   - "Vendor Map" tab:    vendor → category mappings (read/write)
 *
 * Setup:
 *   1. Enable Google Sheets API in your GCP project
 *   2. Create a Service Account and download the JSON key
 *   3. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env
 *   4. Run: node src/setup-sheet.js "My Company"
 *      → creates the sheet and shares it with your personal Google account
 */
const { google } = require("googleapis");
require("dotenv").config();

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in .env"
    );
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// ---------------------------------------------------------------------------
// Transaction columns — order matters, must match header row
// ---------------------------------------------------------------------------
const TXN_HEADERS = [
  "Transaction ID",
  "Date",
  "Description",
  "Merchant",
  "Amount",
  "Type",
  "Category",
  "Matched Vendor",
  "Account",
  "Institution",
  "Company",
  "Currency",
  "Pending",
  "Plaid Category",
  "Plaid Detailed",
  "Synced At",
];

const REVIEW_HEADERS = [
  "Transaction ID",
  "Date",
  "Description",
  "Merchant",
  "Amount",
  "Type",
  "Category",
  "Account",
  "Institution",
];

const VENDOR_MAP_HEADERS = ["Vendor Key", "Category"];

/**
 * Convert a transaction object to a row array matching TXN_HEADERS order.
 */
function txnToRow(t) {
  return [
    t.id,
    t.date,
    t.description,
    t.merchant || "",
    t.amount,
    t.amount > 0 ? "Expense" : "Income",
    t.category || "Uncategorized",
    t.matched_vendor || "",
    t.account_label,
    t.institution,
    t.company,
    t.currency || "USD",
    t.pending ? "Yes" : "No",
    t.plaid_category || "",
    t.plaid_detailed || "",
    new Date().toISOString(),
  ];
}

/**
 * Convert a transaction to a review-queue row.
 */
function txnToReviewRow(t) {
  return [
    t.id,
    t.date,
    t.description,
    t.merchant || "",
    t.amount,
    t.amount > 0 ? "Expense" : "Income",
    "", // Category — left blank for manual entry
    t.account_label,
    t.institution,
  ];
}

// ---------------------------------------------------------------------------
// Core write functions
// ---------------------------------------------------------------------------

/**
 * Append transactions to the "Transactions" tab.
 * Creates the header row if the sheet is empty.
 */
async function writeTransactions(spreadsheetId, transactions) {
  if (transactions.length === 0) return { written: 0 };

  const sheets = getSheetsClient();

  // Ensure header row exists
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Transactions!A1:A1",
  });
  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Transactions!A1",
      valueInputOption: "RAW",
      requestBody: { values: [TXN_HEADERS] },
    });
  }

  // Append rows
  const rows = transactions.map(txnToRow);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Transactions!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  console.log(
    `  [Sheets] Wrote ${rows.length} transactions to Transactions tab`
  );
  return { written: rows.length };
}

/**
 * Replace the "Review Queue" tab with current uncategorized transactions.
 * This is a full replace (not append) so resolved items disappear.
 */
async function writeReviewQueue(spreadsheetId, transactions) {
  const uncategorized = transactions.filter(
    (t) => t.category === "Uncategorized"
  );

  const sheets = getSheetsClient();

  // Clear existing data
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Review Queue!A:Z",
  });

  // Write header + rows
  const rows = [REVIEW_HEADERS, ...uncategorized.map(txnToReviewRow)];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Review Queue!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  console.log(
    `  [Sheets] Wrote ${uncategorized.length} items to Review Queue`
  );
  return { written: uncategorized.length };
}

/**
 * Read the "Vendor Map" tab and return a { vendorKey: category } object.
 * Cowork or the user can edit this tab to add new mappings.
 */
async function readVendorMap(spreadsheetId) {
  const sheets = getSheetsClient();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Vendor Map!A2:B",
    });

    const rows = res.data.values || [];
    const map = {};
    for (const [vendor, category] of rows) {
      if (vendor && category) {
        map[vendor.toUpperCase()] = category;
      }
    }
    return map;
  } catch (err) {
    console.warn("  [Sheets] Could not read Vendor Map:", err.message);
    return {};
  }
}

/**
 * Write the full vendor map to the "Vendor Map" tab.
 */
async function writeVendorMap(spreadsheetId, vendorMap) {
  const sheets = getSheetsClient();

  const rows = [
    VENDOR_MAP_HEADERS,
    ...Object.entries(vendorMap).map(([k, v]) => [k, v]),
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "Vendor Map!A:Z",
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Vendor Map!A1",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });

  console.log(`  [Sheets] Wrote ${rows.length - 1} entries to Vendor Map`);
}

module.exports = {
  writeTransactions,
  writeReviewQueue,
  readVendorMap,
  writeVendorMap,
  TXN_HEADERS,
  REVIEW_HEADERS,
  VENDOR_MAP_HEADERS,
};
