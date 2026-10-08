// Payment-gate rule: a gate milestone holds back the next phase until the client is
// expected to pay. Pure and date-only (YYYY-MM-DD strings) so it is timezone-safe.

export type IsoDate = string; // YYYY-MM-DD

export type GateInvoice = {
  status: "draft" | "sent" | "paid" | "cancelled" | "refunded";
  dueAt: string | null;
  paidAt: string | null;
};

export type GateInput = {
  /** The milestone's (scheduled) date. */
  milestoneEnd: IsoDate;
  /** Latest non-cancelled invoice for the milestone, if any. */
  invoice: GateInvoice | null;
  today: IsoDate;
  termsDays: number;
};

export type PaymentExpectation =
  | { kind: "not-invoiced"; date: IsoDate }
  | { kind: "awaiting"; date: IsoDate }
  | { kind: "overdue"; date: IsoDate }
  | { kind: "paid"; date: IsoDate };

const DAY = 86_400_000;

export const toIsoDate = (value: string | Date): IsoDate =>
  typeof value === "string" ? value.slice(0, 10) : localIsoDate(value);

/** Local calendar date of a Date (Bryntum dates are local midnight). */
export function localIsoDate(date: Date): IsoDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const toUtc = (date: IsoDate) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtc(date) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((toUtc(b) - toUtc(a)) / DAY);

export const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** When the client is expected to pay for a gate milestone. */
export function expectedPayment({ milestoneEnd, invoice, today, termsDays }: GateInput): PaymentExpectation {
  if (invoice?.status === "paid" && invoice.paidAt) {
    return { kind: "paid", date: toIsoDate(invoice.paidAt) };
  }
  if (invoice?.status === "sent" && invoice.dueAt) {
    const due = toIsoDate(invoice.dueAt);
    return today > due ? { kind: "overdue", date: today } : { kind: "awaiting", date: due };
  }
  return { kind: "not-invoiced", date: addDays(maxDate(milestoneEnd, today), termsDays) };
}

/** Earliest start for the milestone's successors, or null when nothing needs holding. */
export function holdDate(input: GateInput): IsoDate | null {
  const { date } = expectedPayment(input);
  return date > toIsoDate(input.milestoneEnd) ? date : null;
}
