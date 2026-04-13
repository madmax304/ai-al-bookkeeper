/**
 * Vendor-map + Plaid-category cascading categorizer.
 *
 *   1. Vendor map (substring match, longest first)       — authoritative
 *   2. Plaid personal_finance_category.primary fallback — best-effort
 *   3. "" (blank — sheet shows as uncategorized)
 *
 * The vendor map can come from the Google Sheet ("Vendor Map" tab) or from
 * the local defaults. The sheet wins when provided so cowork/user can add
 * mappings without touching code.
 */
const fs = require("fs");
const path = require("path");

const PFC_MAP_PATH = path.join(__dirname, "..", "config", "plaid-category-map.json");

const DEFAULT_VENDORS = {
  // Software & SaaS
  OPENAI: "Software & SaaS",
  ANTHROPIC: "Software & SaaS",
  SLACK: "Software & SaaS",
  NOTION: "Software & SaaS",
  GITHUB: "Software & SaaS",
  VERCEL: "Software & SaaS",
  AWS: "Software & SaaS",
  "GOOGLE WORKSPACE": "Software & SaaS",
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
  // Office Supplies
  AMZN: "Office Supplies & Equipment",
  AMAZON: "Office Supplies & Equipment",
  STAPLES: "Office Supplies & Equipment",
  "BEST BUY": "Office Supplies & Equipment",
  APPLE: "Office Supplies & Equipment",
  // Utilities
  "AT&T": "Utilities & Telecom",
  VERIZON: "Utilities & Telecom",
  TMOBILE: "Utilities & Telecom",
  COMCAST: "Utilities & Telecom",
  WEWORK: "Rent",
  // Insurance
  "STATE FARM": "Insurance",
  GEICO: "Insurance",
  PROGRESSIVE: "Insurance",
  // Bank Fees
  "ANNUAL FEE": "Bank Fees & Interest",
  "INTEREST CHARGE": "Bank Fees & Interest",
  "WIRE FEE": "Bank Fees & Interest",
  "LATE FEE": "Bank Fees & Interest",
};

function loadPfcMap() {
  if (!fs.existsSync(PFC_MAP_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(PFC_MAP_PATH, "utf-8"));
  const clean = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith("_")) clean[k] = v;
  }
  return clean;
}

function buildMatcher(vendorMap) {
  const keys = Object.keys(vendorMap).sort((a, b) => b.length - a.length);
  return (description) => {
    const desc = (description || "").toUpperCase();
    for (const vendor of keys) {
      if (desc.includes(vendor.toUpperCase())) {
        return { category: vendorMap[vendor], matched_vendor: vendor };
      }
    }
    return null;
  };
}

/**
 * Categorize a list of transactions using the cascade.
 *   vendorMap: optional { vendorSubstring: category } — defaults to DEFAULT_VENDORS
 */
function categorizeAll(transactions, vendorMap) {
  const effectiveMap = vendorMap || DEFAULT_VENDORS;
  const match = buildMatcher(effectiveMap);
  const pfcMap = loadPfcMap();

  return transactions.map((t) => {
    const hit = match(t.description);
    if (hit) return { ...t, category: hit.category, matched_vendor: hit.matched_vendor };
    if (t.plaid_category && pfcMap[t.plaid_category]) {
      return {
        ...t,
        category: pfcMap[t.plaid_category],
        matched_vendor: `PFC:${t.plaid_category}`,
      };
    }
    return { ...t, category: "", matched_vendor: null };
  });
}

module.exports = { categorizeAll, DEFAULT_VENDORS, buildMatcher, loadPfcMap };
