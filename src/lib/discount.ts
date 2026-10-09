// Early-payment discounts: "pay within N days, save P%". Shared by server and browser.
import { daysBetween, type IsoDate } from "./gates";

export const DISCOUNT_PERCENTS = [1, 2, 3, 5] as const;
export const DISCOUNT_WINDOWS = [3, 7, 15] as const;
export const MAX_DISCOUNT_PERCENT = 10;

export type DiscountOffer = { percent: number; days: number };

/** Validates an offer from a request body; null when absent, throws on nonsense. */
export function parseDiscountOffer(value: unknown): DiscountOffer | null {
  if (value === null || value === undefined) return null;
  const { percent, days } = value as { percent?: unknown; days?: unknown };
  const p = Number(percent);
  const d = Number(days);
  if (!Number.isFinite(p) || p <= 0 || p > MAX_DISCOUNT_PERCENT || Math.abs(p * 100 - Math.round(p * 100)) > 1e-9) {
    throw new RangeError(`Discount must be between 0.01% and ${MAX_DISCOUNT_PERCENT}%.`);
  }
  if (!DISCOUNT_WINDOWS.includes(d as (typeof DISCOUNT_WINDOWS)[number])) {
    throw new RangeError(`Discount window must be ${DISCOUNT_WINDOWS.join(", ")} days.`);
  }
  return { percent: p, days: d };
}

export const discountAmountCents = (amountCents: number, percent: number) => Math.round((amountCents * percent) / 100);

export type DiscountState = "active" | "expired" | "taken" | "missed";

export type DiscountFields = {
  status: string;
  amountCents: number;
  discountPercent: number | null;
  discountUntil: string | null;
  discountExpiredAt: string | null;
  paidAmountCents: number | null;
};

/** How a discounted invoice stands today (null when it has no discount). */
export function discountView(invoice: DiscountFields, today: IsoDate) {
  if (!invoice.discountPercent || !invoice.discountUntil) return null;
  const savingsCents = discountAmountCents(invoice.amountCents, invoice.discountPercent);
  const paid = invoice.status === "paid";
  const taken = paid && invoice.paidAmountCents !== null && invoice.paidAmountCents < invoice.amountCents;
  const state: DiscountState = taken
    ? "taken"
    : paid
      ? "missed"
      : invoice.discountExpiredAt || today > invoice.discountUntil
        ? "expired"
        : "active";
  return {
    percent: invoice.discountPercent,
    until: invoice.discountUntil,
    savingsCents,
    discountedCents: invoice.amountCents - savingsCents,
    daysLeft: state === "active" ? daysBetween(today, invoice.discountUntil) : 0,
    state,
  };
}

export type DiscountSuggestion = {
  recommended: boolean;
  offer: DiscountOffer;
  reason: string;
};

/**
 * Suggests an offer from the simulated schedule benefit of being paid inside the window
 * instead of on the due date. Deterministic (no AI request): the copilot explains it.
 */
export function suggestDiscount(input: {
  amountCents: number;
  isGate: boolean;
  /** Launch days gained if paid on the last day of the window (null if unknown). */
  launchDaysEarlier: number | null;
  windowDays?: number;
}): DiscountSuggestion {
  const days = input.windowDays ?? 7;
  if (!input.isGate) {
    return {
      recommended: false,
      offer: { percent: 2, days },
      reason: "This milestone doesn't hold back later work, so paying early only brings the cash in sooner.",
    };
  }
  const gained = input.launchDaysEarlier ?? 0;
  if (gained < 3) {
    return {
      recommended: false,
      offer: { percent: 2, days },
      reason: `Paying within ${days} days would only move the launch ${gained} day${gained === 1 ? "" : "s"} — probably not worth a discount.`,
    };
  }
  const percent = gained >= 10 && input.amountCents <= 500_000 ? 3 : 2;
  return {
    recommended: true,
    offer: { percent, days },
    reason: `If the client pays within ${days} days, the launch moves about ${gained} days earlier.`,
  };
}

/** Sentence PaidPath appends to the invoice note (and replaces when the offer ends). */
export const DISCOUNT_NOTE_PREFIX = "Early-payment discount:";
export const discountNoteLine = (input: { percent: number; untilLabel: string; savingsLabel: string }) =>
  `${DISCOUNT_NOTE_PREFIX} ${input.percent}% (${input.savingsLabel}) is already taken off if you pay by ${input.untilLabel}.`;
export const discountEndedLine = (untilLabel: string) => `The early-payment discount offer ended on ${untilLabel}.`;

/** Longest standard window that still ends before the due date (7 when possible). */
export const suggestedWindow = (termsDays: number) =>
  termsDays > 7 ? 7 : ([...DISCOUNT_WINDOWS].reverse().find((d) => d < termsDays) ?? null);
