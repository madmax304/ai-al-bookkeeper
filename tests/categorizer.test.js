const { test } = require("node:test");
const assert = require("node:assert/strict");
const { categorizeAll, buildMatcher } = require("../src/categorizer");

const vendorMap = {
  AMZN: "Office Supplies & Equipment",
  AMAZON: "Office Supplies & Equipment",
  "AMAZON WEB SERVICES": "Software & SaaS",
  UBER: "Travel",
  UBEREATS: "Meals & Entertainment",
};

test("vendor match is case-insensitive", () => {
  const m = buildMatcher(vendorMap);
  assert.equal(m("amzn mktp us*ab12").category, "Office Supplies & Equipment");
});

test("longest vendor match wins over shorter", () => {
  const m = buildMatcher(vendorMap);
  assert.equal(m("AMAZON WEB SERVICES INC").category, "Software & SaaS");
  assert.equal(m("UBEREATS ORDER 123").category, "Meals & Entertainment");
});

test("unmatched description returns null", () => {
  const m = buildMatcher(vendorMap);
  assert.equal(m("SOME RANDOM VENDOR"), null);
});

test("categorizeAll falls back to Plaid PFC when vendor miss", () => {
  const txns = [
    { id: "1", description: "Local Bistro", plaid_category: "FOOD_AND_DRINK" },
  ];
  const out = categorizeAll(txns, vendorMap);
  assert.equal(out[0].category, "Meals & Entertainment");
  assert.equal(out[0].matched_vendor, "PFC:FOOD_AND_DRINK");
});

test("categorizeAll blank category when nothing matches", () => {
  const txns = [{ id: "1", description: "Mystery", plaid_category: null }];
  const out = categorizeAll(txns, vendorMap);
  assert.equal(out[0].category, "");
  assert.equal(out[0].matched_vendor, null);
});

test("sheet vendor map wins over Plaid PFC", () => {
  const txns = [
    {
      id: "1",
      description: "UBER TRIP 12345",
      plaid_category: "FOOD_AND_DRINK",
    },
  ];
  const out = categorizeAll(txns, vendorMap);
  assert.equal(out[0].category, "Travel");
});
