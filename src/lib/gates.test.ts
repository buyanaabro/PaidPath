import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, daysBetween, expectedPayment, holdDate, localIsoDate, type GateInput } from "./gates";

const base: GateInput = {
  milestoneEnd: "2026-11-06",
  invoice: null,
  today: "2026-10-08",
  termsDays: 14,
};

describe("date helpers", () => {
  test("add days across month and year boundaries", () => {
    assert.equal(addDays("2026-11-25", 14), "2026-12-09");
    assert.equal(addDays("2026-12-25", 14), "2027-01-08");
    assert.equal(addDays("2027-02-27", 2), "2027-03-01");
  });
  test("daysBetween is signed and whole", () => {
    assert.equal(daysBetween("2026-11-06", "2026-11-20"), 14);
    assert.equal(daysBetween("2026-11-20", "2026-11-06"), -14);
  });
  test("localIsoDate uses the local calendar day", () => {
    assert.equal(localIsoDate(new Date(2026, 10, 2, 23, 59)), "2026-11-02");
  });
});

describe("expectedPayment / holdDate", () => {
  test("not invoiced: milestone end + terms (holds from day one)", () => {
    assert.deepEqual(expectedPayment(base), { kind: "not-invoiced", date: "2026-11-20" });
    assert.equal(holdDate(base), "2026-11-20");
    assert.equal(holdDate({ ...base, termsDays: 7 }), "2026-11-13");
  });

  test("not invoiced and the milestone is already past: today + terms", () => {
    assert.equal(holdDate({ ...base, today: "2026-11-10" }), "2026-11-24");
  });

  test("cancelled invoices count as not invoiced", () => {
    const input = { ...base, invoice: { status: "cancelled" as const, dueAt: "2026-11-20", paidAt: null } };
    assert.equal(expectedPayment(input).kind, "not-invoiced");
  });

  test("sent and not overdue: the due date", () => {
    const input = { ...base, today: "2026-11-06", invoice: { status: "sent" as const, dueAt: "2026-11-20T09:00:00Z", paidAt: null } };
    assert.deepEqual(expectedPayment(input), { kind: "awaiting", date: "2026-11-20" });
    assert.equal(holdDate(input), "2026-11-20");
  });

  test("overdue: today, sliding one day per day", () => {
    const sent = { status: "sent" as const, dueAt: "2026-11-20", paidAt: null };
    assert.deepEqual(expectedPayment({ ...base, today: "2026-11-23", invoice: sent }), { kind: "overdue", date: "2026-11-23" });
    assert.equal(holdDate({ ...base, today: "2026-11-24", invoice: sent }), "2026-11-24");
    // Due today is not overdue yet.
    assert.equal(expectedPayment({ ...base, today: "2026-11-20", invoice: sent }).kind, "awaiting");
  });

  test("paid after the milestone: hold at the payment date", () => {
    const input = { ...base, invoice: { status: "paid" as const, dueAt: "2026-11-20", paidAt: "2026-11-08T12:00:00Z" } };
    assert.equal(holdDate(input), "2026-11-08");
  });

  test("paid on or before the milestone date: released", () => {
    const paid = (paidAt: string) => ({ ...base, invoice: { status: "paid" as const, dueAt: null, paidAt } });
    assert.equal(holdDate(paid("2026-11-06")), null);
    assert.equal(holdDate(paid("2026-11-01")), null);
  });
});
