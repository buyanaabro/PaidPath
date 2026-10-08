import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCashSeries, cashRange } from "./cashflow";

const milestones = [
  { name: "M1", amountCents: 150_000, planned: "2026-11-21", expected: null, received: "2026-11-09" },
  { name: "M2", amountCents: 250_000, planned: "2026-12-14", expected: "2026-11-23", received: null },
  { name: "M3", amountCents: 300_000, planned: "2027-01-08", expected: "2026-12-20", received: null },
];

test("builds cumulative planned / projected / received step series", () => {
  const series = buildCashSeries(milestones);
  assert.deepEqual(series.planned, [
    { date: "2026-11-21", cents: 150_000 },
    { date: "2026-12-14", cents: 400_000 },
    { date: "2027-01-08", cents: 700_000 },
  ]);
  assert.deepEqual(series.projected, [
    { date: "2026-11-09", cents: 150_000 },
    { date: "2026-11-23", cents: 400_000 },
    { date: "2026-12-20", cents: 700_000 },
  ]);
  assert.deepEqual(series.received, [{ date: "2026-11-09", cents: 150_000 }]);
});

test("merges payments on the same day and skips undated ones", () => {
  const series = buildCashSeries([
    { name: "a", amountCents: 100, planned: "2026-11-01", expected: "2026-11-05", received: null },
    { name: "b", amountCents: 200, planned: "2026-11-01", expected: null, received: null },
  ]);
  assert.deepEqual(series.planned, [{ date: "2026-11-01", cents: 300 }]);
  assert.deepEqual(series.projected, [{ date: "2026-11-05", cents: 100 }]);
});

test("range spans all points and today", () => {
  const range = cashRange(buildCashSeries(milestones), "2026-10-08");
  assert.deepEqual(range, { from: "2026-10-08", to: "2027-01-08", days: 92 });
});
