/**
 * Google Sheets I/O — upsert transactions to the "Transactions" tab.
 *
 * The tab's schema is stable so formulas and cowork can rely on column
 * positions. `Category` and `Notes` are user-editable — sync updates all
 * other columns on existing rows but never overwrites these two.
 *
 * New rows get their `Category` pre-filled from the vendor-map match (blank
 * for unknown vendors).
 */
const { google } = require("googleapis");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const TAB = "Transactions";

// Column order (A..P). Must match txnToRow below.
const HEADERS = [
  "Transaction ID",
  "Date",
  "Description",
  "Merchant",
  "Amount",
  "Type",
  "Account",
  "Institution",
  "Matched Vendor",
  "Plaid Category",
  "Plaid Detailed",
  "Category", // user-editable
  "Notes",    // user-editable
  "Pending",
  "Synced At",
];

const COL_ID = 0;
const COL_CATEGORY = 11;
const COL_NOTES = 12;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in env");
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

function txnToRow(t, preservedCategory, preservedNotes) {
  return [
    t.id,
    t.date,
    t.description,
    t.merchant || "",
    t.amount,
    t.amount > 0 ? "Expense" : "Income",
    t.account_label,
    t.institution,
    t.matched_vendor || "",
    t.plaid_category || "",
    t.plaid_detailed || "",
    preservedCategory !== undefined
      ? preservedCategory
      : (t.category && t.category !== "Uncategorized" ? t.category : ""),
    preservedNotes !== undefined ? preservedNotes : "",
    t.pending ? "Yes" : "No",
    new Date().toISOString(),
  ];
}

async function ensureTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === TAB);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: TAB,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        },
      ],
    },
  });
}

async function ensureHeaders(sheets, spreadsheetId) {
  await ensureTab(sheets, spreadsheetId);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A1:${colLetter(HEADERS.length)}1`,
  });
  const current = (res.data.values && res.data.values[0]) || [];
  const matches = HEADERS.every((h, i) => current[i] === h);
  if (!matches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
  }
}

async function getSheetId(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!tab) throw new Error(`Tab "${TAB}" not found in spreadsheet`);
  return tab.properties.sheetId;
}

function colLetter(n) {
  // 1-indexed column number -> A1 letter
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Upsert a batch of transactions.
 *
 *   added:   txns to add or update
 *   removed: Plaid removed records (either { transaction_id } objects or bare ids)
 *
 * Pending→posted transition: Plaid sets `pending_transaction_id` on the posted
 * txn pointing at the earlier pending row. We delete the pending row so it
 * doesn't show up twice.
 */
async function upsertTransactions(spreadsheetId, added, removed = []) {
  const sheets = getClient();
  await ensureHeaders(sheets, spreadsheetId);

  // 1. Read existing ids + user-editable columns
  const lastCol = colLetter(HEADERS.length);
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A2:${lastCol}`,
  });
  const existingRows = existingRes.data.values || [];
  const existingById = new Map();
  existingRows.forEach((row, i) => {
    const id = row[COL_ID];
    if (id) {
      existingById.set(id, {
        rowIndex: i + 2, // sheet row (1-indexed, +1 for header)
        category: row[COL_CATEGORY] || "",
        notes: row[COL_NOTES] || "",
      });
    }
  });

  // 2. Split incoming into updates vs appends; collect pending rows to drop
  const updates = []; // { range, values }
  const appends = []; // row arrays
  const rowsToDelete = new Set(); // 0-indexed row numbers (for deleteDimension)

  for (const t of added) {
    const existing = existingById.get(t.id);
    // If this posted txn supersedes a pending one, carry the user's edits
    // from the pending row before we delete it below.
    const pending =
      t.pending_transaction_id && existingById.get(t.pending_transaction_id);

    if (existing) {
      const row = txnToRow(t, existing.category, existing.notes);
      updates.push({
        range: `${TAB}!A${existing.rowIndex}:${lastCol}${existing.rowIndex}`,
        values: [row],
      });
    } else {
      const carryCat = pending ? pending.category : undefined;
      const carryNotes = pending ? pending.notes : undefined;
      appends.push(txnToRow(t, carryCat, carryNotes));
    }
    if (pending) {
      rowsToDelete.add(pending.rowIndex - 1);
    }
  }

  // 3. Removed ids -> delete rows
  for (const r of removed) {
    const id = typeof r === "string" ? r : r.transaction_id;
    const existing = existingById.get(id);
    if (existing) rowsToDelete.add(existing.rowIndex - 1);
  }

  // 4. Execute updates
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  // 5. Execute appends
  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TAB}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: appends },
    });
  }

  // 6. Execute deletes (descending, so earlier indices stay valid)
  if (rowsToDelete.size > 0) {
    const sheetId = await getSheetId(sheets, spreadsheetId);
    const sorted = [...rowsToDelete].sort((a, b) => b - a);
    const requests = sorted.map((rowIdx) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        },
      },
    }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  console.log(
    `  [Sheets] upsert: ${appends.length} new, ${updates.length} updated, ${rowsToDelete.size} deleted`
  );
  return {
    added: appends.length,
    updated: updates.length,
    deleted: rowsToDelete.size,
  };
}

/**
 * Read the Vendor Map tab (two columns: substring, category) into a plain
 * object. Returns null if the tab doesn't exist or is empty — callers should
 * fall back to local defaults.
 */
async function readVendorMap(spreadsheetId) {
  const sheets = getClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Vendor Map!A2:B",
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return null;
    const map = {};
    for (const [vendor, category] of rows) {
      if (vendor && category) map[vendor.toUpperCase()] = category;
    }
    return Object.keys(map).length > 0 ? map : null;
  } catch (err) {
    // Tab missing is fine; fall back to defaults silently
    if (err.response?.status === 400 || err.code === 400) return null;
    throw err;
  }
}

/**
 * Detect transfer pairs across accounts and stamp Type = "Transfer" on both
 * rows. A pair is two rows with equal |amount|, opposite signs, different
 * accounts, and dates within `windowDays`. Reads from the sheet so it catches
 * transfers that span sync runs (e.g. AMEX charge today, Chase payment
 * clearing tomorrow).
 *
 * Returns { pairs: N, patched: N }. Idempotent — skips rows already marked.
 */
/**
 * Pure: given parsed rows, return which ones should be marked Type="Transfer".
 * Exported for testing.
 *
 *   rows:        [{ id, date, amount, type, account }]
 *   windowDays:  max date gap between the two sides of a transfer
 *   Returns:     [{ rowIndex, id }] — caller decides how to write
 */
function findTransferPairs(rows, { windowDays = 3 } = {}) {
  const dayMs = 86400000;
  const used = new Set();
  const toMark = [];
  const expenses = rows.filter((r) => r.amount > 0);
  const incomes = rows.filter((r) => r.amount < 0);

  for (const e of expenses) {
    if (used.has(e.id)) continue;
    for (const i of incomes) {
      if (used.has(i.id)) continue;
      if (i.account === e.account) continue;
      if (Math.abs(Math.abs(i.amount) - e.amount) > 0.005) continue;
      const dd = Math.abs(new Date(e.date) - new Date(i.date));
      if (dd > windowDays * dayMs) continue;
      used.add(e.id);
      used.add(i.id);
      for (const r of [e, i]) {
        if (r.type !== "Transfer") toMark.push(r);
      }
      break;
    }
  }
  return toMark;
}

async function markTransfers(spreadsheetId, opts = {}) {
  const sheets = getClient();
  const lastCol = colLetter(HEADERS.length);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A2:${lastCol}`,
  });
  const sheetRows = res.data.values || [];
  if (sheetRows.length === 0) return { pairs: 0, patched: 0 };

  const IDX_ID = 0, IDX_DATE = 1, IDX_AMOUNT = 4, IDX_TYPE = 5, IDX_ACCT = 6;
  const parsed = sheetRows
    .map((r, i) => ({
      rowIndex: i + 2,
      id: r[IDX_ID],
      date: r[IDX_DATE],
      amount: parseFloat(r[IDX_AMOUNT]),
      type: r[IDX_TYPE],
      account: r[IDX_ACCT],
    }))
    .filter((r) => r.id && !Number.isNaN(r.amount));

  const toMark = findTransferPairs(parsed, opts);
  if (toMark.length === 0) return { pairs: 0, patched: 0 };

  const typeCol = colLetter(IDX_TYPE + 1);
  const patches = toMark.map((r) => ({
    range: `${TAB}!${typeCol}${r.rowIndex}`,
    values: [["Transfer"]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: patches },
  });
  return { pairs: toMark.length / 2, patched: toMark.length };
}

module.exports = {
  upsertTransactions,
  readVendorMap,
  markTransfers,
  findTransferPairs,
  HEADERS,
  TAB,
};
