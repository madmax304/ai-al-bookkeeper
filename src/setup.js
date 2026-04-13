/**
 * One-time / idempotent sheet setup.
 *
 * Creates the supporting tabs (Chart of Accounts, Vendor Map, Review Queue,
 * P&L), seeds them with defaults, and applies data validation + conditional
 * formatting to the Transactions tab so the Category column is a dropdown
 * and uncategorized rows get highlighted.
 *
 * Safe to re-run: tabs are only created if missing, and seed rows are only
 * written when the tab was just created. Data validation and conditional
 * formatting are overwritten each run (cheap, harmless).
 *
 *   npm run setup
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
const { google } = require("googleapis");
const { DEFAULT_VENDORS } = require("./categorizer");
const { HEADERS: TXN_HEADERS, TAB: TXN_TAB } = require("./sheets");

const COA_TAB = "Chart of Accounts";
const VENDOR_TAB = "Vendor Map";
const REVIEW_TAB = "Review Queue";
const PNL_TAB = "P&L";
const VENDOR_SPEND_TAB = "Vendor Spend";

const CATEGORY_COL_INDEX = TXN_HEADERS.indexOf("Category"); // 0-based
const PENDING_COL_INDEX = TXN_HEADERS.indexOf("Pending");
const TYPE_COL_INDEX = TXN_HEADERS.indexOf("Type");

// Default Chart of Accounts — edit in the sheet to match your business.
const DEFAULT_COA = [
  ["Category", "Type"],
  ["Revenue", "Income"],
  ["Other Income", "Income"],
  ["Cost of Goods Sold", "COGS"],
  ["Contractor Payments", "COGS"],
  ["Advertising & Marketing", "Expense"],
  ["Bank Fees & Interest", "Expense"],
  ["Insurance", "Expense"],
  ["Meals & Entertainment", "Expense"],
  ["Office Supplies & Equipment", "Expense"],
  ["Payroll", "Expense"],
  ["Professional Services", "Expense"],
  ["Rent", "Expense"],
  ["Software & SaaS", "Expense"],
  ["Travel", "Expense"],
  ["Utilities & Telecom", "Expense"],
  ["Owner Draw", "Other"],
  ["Owner Contribution", "Other"],
  ["Transfer", "Transfer"],
  ["Uncategorized", "Other"],
];

const VENDOR_HEADER = ["Vendor Substring", "Category"];

function getClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return Object.fromEntries(
    meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId])
  );
}

async function addTab(sheets, spreadsheetId, title, opts = {}) {
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1 },
              ...(opts.tabColor ? { tabColorStyle: { rgbColor: opts.tabColor } } : {}),
            },
          },
        },
      ],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function writeValues(sheets, spreadsheetId, range, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function setupChartOfAccounts(sheets, spreadsheetId, tabs) {
  if (COA_TAB in tabs) return; // already exists; leave user's edits alone
  await addTab(sheets, spreadsheetId, COA_TAB, {
    tabColor: { red: 0.2, green: 0.66, blue: 0.33 },
  });
  await writeValues(sheets, spreadsheetId, `${COA_TAB}!A1`, DEFAULT_COA);
  console.log(`  + ${COA_TAB} (${DEFAULT_COA.length - 1} accounts)`);
}

async function setupVendorMap(sheets, spreadsheetId, tabs) {
  if (VENDOR_TAB in tabs) return;
  await addTab(sheets, spreadsheetId, VENDOR_TAB, {
    tabColor: { red: 0.3, green: 0.5, blue: 0.9 },
  });
  const rows = [
    VENDOR_HEADER,
    ...Object.entries(DEFAULT_VENDORS).map(([k, v]) => [k, v]),
  ];
  await writeValues(sheets, spreadsheetId, `${VENDOR_TAB}!A1`, rows);
  console.log(`  + ${VENDOR_TAB} (${rows.length - 1} mappings)`);
}

async function setupReviewQueue(sheets, spreadsheetId, tabs) {
  if (REVIEW_TAB in tabs) return;
  await addTab(sheets, spreadsheetId, REVIEW_TAB, {
    tabColor: { red: 1, green: 0.6, blue: 0 },
  });
  // Live view of uncategorized, non-pending rows.
  const query = `=QUERY(${TXN_TAB}!A:O, "select A, B, C, D, E, G, H, J where L = '' and N = 'No' order by B desc", 1)`;
  await writeValues(sheets, spreadsheetId, `${REVIEW_TAB}!A1`, [[query]]);
  console.log(`  + ${REVIEW_TAB} (live QUERY)`);
}

async function setupPnl(sheets, spreadsheetId, tabs) {
  if (PNL_TAB in tabs) return;
  await addTab(sheets, spreadsheetId, PNL_TAB, {
    tabColor: { red: 0.45, green: 0.2, blue: 0.7 },
  });
  // Per-category totals across three timeframes. ARRAYFORMULA expands
  // automatically as you add categories in Chart of Accounts.
  // Amounts: Plaid uses +expense / -income, so we show the raw sign.
  const rows = [
    ["Category", "This Month", "YTD", "All Time"],
    [
      `=IFERROR(ARRAYFORMULA(IF('${COA_TAB}'!A2:A="", "", '${COA_TAB}'!A2:A)))`,
      `=IFERROR(ARRAYFORMULA(IF('${COA_TAB}'!A2:A="", "", SUMIFS(${TXN_TAB}!E:E, ${TXN_TAB}!L:L, '${COA_TAB}'!A2:A, ${TXN_TAB}!B:B, ">="&EOMONTH(TODAY(),-1)+1, ${TXN_TAB}!B:B, "<="&EOMONTH(TODAY(),0)))))`,
      `=IFERROR(ARRAYFORMULA(IF('${COA_TAB}'!A2:A="", "", SUMIFS(${TXN_TAB}!E:E, ${TXN_TAB}!L:L, '${COA_TAB}'!A2:A, ${TXN_TAB}!B:B, ">="&DATE(YEAR(TODAY()),1,1)))))`,
      `=IFERROR(ARRAYFORMULA(IF('${COA_TAB}'!A2:A="", "", SUMIFS(${TXN_TAB}!E:E, ${TXN_TAB}!L:L, '${COA_TAB}'!A2:A))))`,
    ],
  ];
  await writeValues(sheets, spreadsheetId, `${PNL_TAB}!A1`, rows);
  console.log(`  + ${PNL_TAB} (per-category / month / YTD / all-time)`);
}

async function setupVendorSpend(sheets, spreadsheetId, tabs) {
  if (VENDOR_SPEND_TAB in tabs) return;
  await addTab(sheets, spreadsheetId, VENDOR_SPEND_TAB, {
    tabColor: { red: 0.2, green: 0.4, blue: 0.6 },
  });
  // Top spend by merchant (falls back to description when merchant is blank).
  // Excludes transfers and income.
  const query =
    `=QUERY({${TXN_TAB}!A:O}, ` +
    `"select Col3, Col12, sum(Col5), count(Col1) ` +
    `where Col6='Expense' and Col12 <> 'Transfer' ` +
    `group by Col3, Col12 ` +
    `order by sum(Col5) desc ` +
    `label Col3 'Description', Col12 'Category', sum(Col5) 'Total Spend', count(Col1) 'Txns'", 1)`;
  await writeValues(sheets, spreadsheetId, `${VENDOR_SPEND_TAB}!A1`, [[query]]);
  console.log(`  + ${VENDOR_SPEND_TAB} (sorted by total spend)`);
}

async function applyCategoryValidation(sheets, spreadsheetId, tabs) {
  const txnSheetId = tabs[TXN_TAB];
  if (txnSheetId === undefined) return;
  // Dropdown on Transactions!Category (column L) sourced from Chart of Accounts!A2:A
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: txnSheetId,
              startRowIndex: 1, // skip header
              startColumnIndex: CATEGORY_COL_INDEX,
              endColumnIndex: CATEGORY_COL_INDEX + 1,
            },
            rule: {
              condition: {
                type: "ONE_OF_RANGE",
                values: [{ userEnteredValue: `='${COA_TAB}'!A2:A` }],
              },
              showCustomUi: true,
              strict: false, // allow free-text so users aren't blocked
            },
          },
        },
      ],
    },
  });
  console.log(`  · Category dropdown wired to ${COA_TAB}`);
}

async function applyUncategorizedHighlight(sheets, spreadsheetId, tabs) {
  const txnSheetId = tabs[TXN_TAB];
  if (txnSheetId === undefined) return;
  const catCol = colLetter(CATEGORY_COL_INDEX + 1);
  const pendCol = colLetter(PENDING_COL_INDEX + 1);
  // Build the formula via string math so we can reference relative cells.
  const formula = `=AND($${catCol}2="", $${pendCol}2="No")`;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId: txnSheetId,
                  startRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: TXN_HEADERS.length,
                },
              ],
              booleanRule: {
                condition: {
                  type: "CUSTOM_FORMULA",
                  values: [{ userEnteredValue: formula }],
                },
                format: {
                  backgroundColor: { red: 1, green: 0.96, blue: 0.8 },
                },
              },
            },
            index: 0,
          },
        },
      ],
    },
  });
  console.log("  · Conditional format: highlight uncategorized non-pending rows");
}

async function setup(spreadsheetId) {
  if (!spreadsheetId) throw new Error("spreadsheetId required");
  const sheets = getClient();
  console.log(`\nSetup: ${spreadsheetId}`);

  const tabs = await getTabs(sheets, spreadsheetId);
  if (!(TXN_TAB in tabs)) {
    console.log(`  ! "${TXN_TAB}" tab missing. Run \`npm run sync\` once first to create it.`);
  }

  await setupChartOfAccounts(sheets, spreadsheetId, tabs);
  await setupVendorMap(sheets, spreadsheetId, tabs);
  await setupReviewQueue(sheets, spreadsheetId, tabs);
  await setupPnl(sheets, spreadsheetId, tabs);
  await setupVendorSpend(sheets, spreadsheetId, tabs);

  // Re-fetch so the newly-created CoA sheet id is available if needed later.
  const refreshed = await getTabs(sheets, spreadsheetId);
  await applyCategoryValidation(sheets, spreadsheetId, refreshed);
  await applyUncategorizedHighlight(sheets, spreadsheetId, refreshed);

  console.log("\nDone.\n");
}

if (require.main === module) {
  const id = process.argv[2] || process.env.NATAL_SHEET_ID;
  setup(id).catch((err) => {
    console.error("Setup failed:", err.response?.data || err.message);
    process.exit(1);
  });
}

module.exports = { setup };
