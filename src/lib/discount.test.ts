import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discountAmountCents, discountView, parseDiscountOffer, suggestDiscount, suggestedWindow, type DiscountFields } from "./discount";

const base: DiscountFields = {
  status: "sent",
  amountCents: 250_000,
  discountPercent: 2,
  discountUntil: "2026-11-27",
  discountExpiredAt: null,
  paidAmountCents: null,
};

describe("discount offers", () => {
  test("parses valid offers and rejects nonsense", () => {
    assert.equal(parseDiscountOffer(undefined), null);
    assert.deepEqual(parseDiscountOffer({ percent: 2, days: 7 }), { percent: 2, days: 7 });
    assert.deepEqual(parseDiscountOffer({ percent: "2.5", days: "15" }), { percent: 2.5, days: 15 });
    for (const bad of [{ percent: 0, days: 7 }, { percent: 11, days: 7 }, { percent: 2, days: 10 }, { percent: 1.234, days: 7 }, { percent: "x", days: 7 }]) {
      assert.throws(() => parseDiscountOffer(bad), RangeError);
    }
  });

  test("rounds the saving to cents", () => {
    assert.equal(discountAmountCents(250_000, 2), 5_000);
    assert.equal(discountAmountCents(99_999, 3), 3_000);
  });

  test("states: active → expired, taken, missed", () => {
    assert.deepEqual(discountView(base, "2026-11-20"), {
      percent: 2,
      until: "2026-11-27",
      savingsCents: 5_000,
      discountedCents: 245_000,
      daysLeft: 7,
      state: "active",
    });
    assert.equal(discountView(base, "2026-11-27")!.state, "active");
    assert.equal(discountView(base, "2026-11-28")!.state, "expired");
    assert.equal(discountView({ ...base, discountExpiredAt: "2026-11-28T12:00:00Z" }, "2026-11-20")!.state, "expired");
    assert.equal(discountView({ ...base, status: "paid", paidAmountCents: 245_000 }, "2026-11-25")!.state, "taken");
    assert.equal(discountView({ ...base, status: "paid", paidAmountCents: 250_000 }, "2026-12-02")!.state, "missed");
    assert.equal(discountView({ ...base, discountPercent: null }, "2026-11-20"), null);
  });
});

describe("suggestDiscount", () => {
  test("recommends only when paying early moves the launch meaningfully", () => {
    assert.equal(suggestDiscount({ amountCents: 250_000, isGate: false, launchDaysEarlier: 20 }).recommended, false);
    assert.equal(suggestDiscount({ amountCents: 250_000, isGate: true, launchDaysEarlier: 2 }).recommended, false);
    assert.deepEqual(suggestDiscount({ amountCents: 250_000, isGate: true, launchDaysEarlier: 5 }).offer, { percent: 2, days: 7 });
    assert.deepEqual(suggestDiscount({ amountCents: 250_000, isGate: true, launchDaysEarlier: 12 }).offer, { percent: 3, days: 7 });
    assert.deepEqual(suggestDiscount({ amountCents: 900_000, isGate: true, launchDaysEarlier: 12 }).offer, { percent: 2, days: 7 });
    assert.match(suggestDiscount({ amountCents: 250_000, isGate: true, launchDaysEarlier: 12 }).reason, /about 12 days earlier/);
    assert.deepEqual(suggestDiscount({ amountCents: 250_000, isGate: true, launchDaysEarlier: 4, windowDays: 3 }).offer, { percent: 2, days: 3 });
  });

  test("the window always ends before the due date", () => {
    assert.equal(suggestedWindow(14), 7);
    assert.equal(suggestedWindow(30), 7);
    assert.equal(suggestedWindow(7), 3);
    assert.equal(suggestedWindow(3), null);
  });
});
