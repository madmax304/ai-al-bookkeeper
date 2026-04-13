/**
 * Google Sheet Setup Script
 *
 * Initializes an existing Google Sheet with the correct tabs, headers,
 * formatting, and default vendor map.
 *
 * Prerequisites:
 *   1. Create a blank Google Sheet manually
 *   2. Share it with your service account email (Editor access)
 *   3. Run this script with the spreadsheet ID
 *
 * Usage:
 *   node src/setup-sheet.js "Company Name" "SPREADSHEET_ID_OR_URL"
 *
 * The spreadsheet ID is saved to data/sheet-config.json so the sync
 * pipeline knows where to write.
 */
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONFIG_PATH = path.join(__dirname, "..", "data", "sheet-config.json");

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
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

/**
 * Extract a spreadsheet ID from a URL or return the raw ID.
 */
function parseSpreadsheetId(input) {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : input;
}

async function setupSheet(companyName, spreadsheetIdOrUrl) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = parseSpreadsheetId(spreadsheetIdOrUrl);

  console.log(`\nSetting up sheet for "${companyName}"...`);
  console.log(`  Spreadsheet ID: ${spreadsheetId}\n`);

  // 1. Get the existing sheet to find the default tab's sheetId
  const existing = await sheets.spreadsheets.get({ spreadsheetId });
  const defaultSheet = existing.data.sheets[0];
  const defaultSheetId = defaultSheet.properties.sheetId;

  // 2. Rename default sheet to "Transactions" and add the other tabs
  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: defaultSheetId,
          title: "Transactions",
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "title,gridProperties.frozenRowCount",
      },
    },
    {
      addSheet: {
        properties: {
          title: "Review Queue",
          gridProperties: { frozenRowCount: 1 },
          tabColorStyle: {
            rgbColor: { red: 1, green: 0.6, blue: 0 },
          },
        },
      },
    },
    {
      addSheet: {
        properties: {
          title: "Vendor Map",
          gridProperties: { frozenRowCount: 1 },
          tabColorStyle: {
            rgbColor: { red: 0.2, green: 0.66, blue: 0.33 },
          },
        },
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  console.log("  Created tabs: Transactions, Review Queue, Vendor Map");

  // 3. Write header rows
  const { TXN_HEADERS, REVIEW_HEADERS, VENDOR_MAP_HEADERS } = require("./sheets");

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: "Transactions!A1", values: [TXN_HEADERS] },
        { range: "Review Queue!A1", values: [REVIEW_HEADERS] },
        { range: "Vendor Map!A1", values: [VENDOR_MAP_HEADERS] },
      ],
    },
  });
  console.log("  Wrote header rows to all tabs");

  // 4. Write the default vendor map
  const { loadVendorMap } = require("./categorizer");
  const vendorMap = loadVendorMap();
  const vendorRows = Object.entries(vendorMap).map(([k, v]) => [k, v]);
  if (vendorRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Vendor Map!A2",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: vendorRows },
    });
    console.log(`  Wrote ${vendorRows.length} default vendor mappings`);
  }

  // 5. Bold and color header rows
  const updatedSheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetIds = updatedSheet.data.sheets.map((s) => s.properties.sheetId);

  const formatRequests = sheetIds.flatMap((sheetId) => [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.9, green: 0.93, blue: 0.96 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: "COLUMNS" },
      },
    },
  ]);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: formatRequests },
  });
  console.log("  Formatted headers");

  // 6. Rename the spreadsheet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSpreadsheetProperties: {
            properties: { title: `${companyName} — Bookkeeper Ledger` },
            fields: "title",
          },
        },
      ],
    },
  });

  // 7. Save config
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let config = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  }
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  config[companyName] = {
    spreadsheetId,
    spreadsheetUrl,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\n  Sheet URL: ${spreadsheetUrl}`);
  console.log(`  Config saved to data/sheet-config.json`);
  console.log(`\n  Done!\n`);

  return { spreadsheetId, spreadsheetUrl };
}

// CLI entry point
if (require.main === module) {
  const company = process.argv[2];
  const sheetId = process.argv[3];

  if (!company || !sheetId) {
    console.error(
      'Usage: node src/setup-sheet.js "Company Name" "SPREADSHEET_ID_OR_URL"'
    );
    console.error(
      "\n  1. Create a blank Google Sheet at sheets.google.com"
    );
    console.error(
      "  2. Share it with your service account email (Editor)"
    );
    console.error(
      "  3. Copy the URL and pass it as the second argument\n"
    );
    process.exit(1);
  }

  setupSheet(company, sheetId).catch((err) => {
    console.error("Setup failed:", err.message);
    process.exit(1);
  });
}

module.exports = { setupSheet, CONFIG_PATH };
