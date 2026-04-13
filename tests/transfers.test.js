const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findTransferPairs } = require("../src/sheets");

test("matches expense + income of same magnitude across accounts", () => {
  const rows = [
    { id: "a", date: "2026-01-10", amount: 1200.5, type: "Expense", account: "chase" },
    { id: "b", date: "2026-01-11", amount: -1200.5, type: "Income", account: "amex" },
  ];
  const marked = findTransferPairs(rows);
  assert.deepEqual(marked.map((r) => r.id).sort(), ["a", "b"]);
});

test("does not match same-account pairs", () => {
  const rows = [
    { id: "a", date: "2026-01-10", amount: 50, type: "Expense", account: "chase" },
    { id: "b", date: "2026-01-10", amount: -50, type: "Income", account: "chase" },
  ];
  assert.deepEqual(findTransferPairs(rows), []);
});

test("respects date window", () => {
  const rows = [
    { id: "a", date: "2026-01-01", amount: 100, type: "Expense", account: "chase" },
    { id: "b", date: "2026-01-10", amount: -100, type: "Income", account: "amex" },
  ];
  assert.deepEqual(findTransferPairs(rows, { windowDays: 3 }), []);
  const wide = findTransferPairs(rows, { windowDays: 15 });
  assert.equal(wide.length, 2);
});

test("skips rows already marked Transfer", () => {
  const rows = [
    { id: "a", date: "2026-01-10", amount: 75, type: "Transfer", account: "chase" },
    { id: "b", date: "2026-01-10", amount: -75, type: "Transfer", account: "amex" },
  ];
  assert.deepEqual(findTransferPairs(rows), []);
});

test("one expense pairs only once", () => {
  const rows = [
    { id: "a", date: "2026-01-10", amount: 200, type: "Expense", account: "chase" },
    { id: "b", date: "2026-01-10", amount: -200, type: "Income", account: "amex" },
    { id: "c", date: "2026-01-10", amount: -200, type: "Income", account: "amex" },
  ];
  const marked = findTransferPairs(rows);
  assert.equal(marked.length, 2);
});
