import { daysBetween, type IsoDate } from "./gates";

export type MilestoneCash = {
  name: string;
  amountCents: number;
  /** Baseline (planned) payment date. */
  planned: IsoDate | null;
  /** Expected payment date under the current, payment-aware schedule (null once paid). */
  expected: IsoDate | null;
  /** Actual payment date, when paid. */
  received: IsoDate | null;
};

export type CashPoint = { date: IsoDate; cents: number };
export type CashSeries = { planned: CashPoint[]; projected: CashPoint[]; received: CashPoint[] };

/** Cumulative step series; dates sorted ascending, amounts summed per day. */
function cumulative(entries: { date: IsoDate | null; cents: number }[]): CashPoint[] {
  const byDay = new Map<IsoDate, number>();
  for (const { date, cents } of entries) if (date) byDay.set(date, (byDay.get(date) ?? 0) + cents);
  let total = 0;
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, cents]) => ({ date, cents: (total += cents) }));
}

/**
 * planned  = baseline payment dates
 * projected = received payments + still-expected payments (what you'll have, when)
 * received = actual PayPal payments so far
 */
export function buildCashSeries(milestones: MilestoneCash[]): CashSeries {
  return {
    planned: cumulative(milestones.map((m) => ({ date: m.planned, cents: m.amountCents }))),
    projected: cumulative(milestones.map((m) => ({ date: m.received ?? m.expected, cents: m.amountCents }))),
    received: cumulative(milestones.map((m) => ({ date: m.received, cents: m.amountCents }))),
  };
}

/** Date range covering every point plus `today`. */
export function cashRange(series: CashSeries, today: IsoDate): { from: IsoDate; to: IsoDate; days: number } {
  const dates = [today, ...series.planned, ...series.projected, ...series.received].map((p) =>
    typeof p === "string" ? p : p.date,
  );
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));
  return { from, to, days: Math.max(1, daysBetween(from, to)) };
}
