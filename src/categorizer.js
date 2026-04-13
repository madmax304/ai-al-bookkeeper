/**
 * Transaction Categorizer
 *
 * Matches transaction descriptions against a vendor map to auto-assign categories.
 * Unknown vendors go to the "Review Queue" for manual categorization.
 *
 * The vendor map is a simple object:
 *   { "OPENAI": "Software & SaaS", "DELTA": "Travel", ... }
 *
 * Matching is case-insensitive and uses "contains" logic:
 *   Transaction "AMZN MKTP US*AB1CD2EFG" matches vendor key "AMZN" → "Office Supplies"
 */

const fs = require("fs");
const path = require("path");

const VENDOR_MAP_PATH = path.join(__dirname, "..", "data", "vendor-map.json");

// Default vendor map — gets expanded as you categorize transactions
const DEFAULT_VENDORS = {
  // Software & SaaS
  OPENAI: "Software & SaaS",
  SLACK: "Software & SaaS",
  NOTION: "Software & SaaS",
  GITHUB: "Software & SaaS",
  VERCEL: "Software & SaaS",
  HEROKU: "Software & SaaS",
  AWS: "Software & SaaS",
  GOOGLE: "Software & SaaS",
  MICROSOFT: "Software & SaaS",
  ADOBE: "Software & SaaS",
  ZOOM: "Software & SaaS",
  DROPBOX: "Software & SaaS",
  FIGMA: "Software & SaaS",

  // Advertising & Marketing
  "FACEBK ADS": "Advertising & Marketing",
  "FB ADS": "Advertising & Marketing",
  "GOOGLE ADS": "Advertising & Marketing",
  "META ADS": "Advertising & Marketing",
  LINKEDIN: "Advertising & Marketing",

  // Travel
  DELTA: "Travel",
  UNITED: "Travel",
  AMERICAN: "Travel",
  SOUTHWEST: "Travel",
  UBER: "Travel",
  LYFT: "Travel",
  MARRIOTT: "Travel",
  HILTON: "Travel",
  AIRBNB: "Travel",

  // Meals & Entertainment
  DOORDASH: "Meals & Entertainment",
  GRUBHUB: "Meals & Entertainment",
  UBEREATS: "Meals & Entertainment",
  STARBUCKS: "Meals & Entertainment",

  // Office Supplies & Equipment
  AMZN: "Office Supplies & Equipment",
  AMAZON: "Office Supplies & Equipment",
  STAPLES: "Office Supplies & Equipment",
  "BEST BUY": "Office Supplies & Equipment",
  APPLE: "Office Supplies & Equipment",

  // Utilities & Telecom
  "AT&T": "Utilities & Telecom",
  VERIZON: "Utilities & Telecom",
  TMOBILE: "Utilities & Telecom",
  COMCAST: "Utilities & Telecom",
  WEWORK: "Utilities & Telecom",

  // Insurance
  "STATE FARM": "Insurance",
  GEICO: "Insurance",
  PROGRESSIVE: "Insurance",

  // Bank Fees & Interest
  "ANNUAL FEE": "Bank Fees & Interest",
  "INTEREST CHARGE": "Bank Fees & Interest",
  "WIRE FEE": "Bank Fees & Interest",
  "LATE FEE": "Bank Fees & Interest",
};

function loadVendorMap() {
  const dir = path.dirname(VENDOR_MAP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(VENDOR_MAP_PATH)) {
    fs.writeFileSync(VENDOR_MAP_PATH, JSON.stringify(DEFAULT_VENDORS, null, 2));
    return DEFAULT_VENDORS;
  }
  return JSON.parse(fs.readFileSync(VENDOR_MAP_PATH, "utf-8"));
}

function saveVendorMap(map) {
  const dir = path.dirname(VENDOR_MAP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VENDOR_MAP_PATH, JSON.stringify(map, null, 2));
}

/**
 * Categorize a single transaction.
 * Returns { category, matched_vendor } or { category: "Uncategorized", matched_vendor: null }
 */
function categorize(description) {
  const vendorMap = loadVendorMap();
  const descUpper = (description || "").toUpperCase();

  // Try to match against vendor map (longest match first for specificity)
  const keys = Object.keys(vendorMap).sort((a, b) => b.length - a.length);

  for (const vendor of keys) {
    if (descUpper.includes(vendor.toUpperCase())) {
      return { category: vendorMap[vendor], matched_vendor: vendor };
    }
  }

  return { category: "Uncategorized", matched_vendor: null };
}

/**
 * Categorize an array of transactions.
 * Each transaction should have at least a `description` field.
 * Returns the same array with `category` and `matched_vendor` added.
 */
function categorizeAll(transactions) {
  const vendorMap = loadVendorMap();
  const keys = Object.keys(vendorMap).sort((a, b) => b.length - a.length);

  return transactions.map((txn) => {
    const descUpper = (txn.description || "").toUpperCase();
    for (const vendor of keys) {
      if (descUpper.includes(vendor.toUpperCase())) {
        return { ...txn, category: vendorMap[vendor], matched_vendor: vendor };
      }
    }
    return { ...txn, category: "Uncategorized", matched_vendor: null };
  });
}

/**
 * Learn a new vendor mapping. Call this when a user categorizes
 * a transaction from the Review Queue.
 */
function learnVendor(vendorKey, category) {
  const map = loadVendorMap();
  map[vendorKey.toUpperCase()] = category;
  saveVendorMap(map);
  console.log(`Learned: "${vendorKey}" → "${category}"`);
}

module.exports = { categorize, categorizeAll, learnVendor, loadVendorMap };
