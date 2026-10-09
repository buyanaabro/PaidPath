import assert from "node:assert/strict";
import { test } from "node:test";
import { guideProgress } from "./demo-guide";

test("demo guide steps tick off from invoices and agent activity", () => {
  const empty = guideProgress({ invoices: [], actions: ["demo_created"] });
  assert.equal(empty.completed, 0);
  assert.equal(empty.current?.id, "send");

  const sent = guideProgress({ invoices: [{ status: "sent", overdue: false }], actions: [] });
  assert.deepEqual(sent.steps.map((s) => s.done), [true, false, false, false, false]);
  assert.equal(sent.current?.id, "client");

  const all = guideProgress({
    invoices: [
      { status: "paid", overdue: false },
      { status: "sent", overdue: true },
    ],
    actions: ["copilot_turn", "portal_viewed"],
  });
  assert.equal(all.completed, 5);
  assert.equal(all.current, null);

  // Out of order is fine: the first unfinished step is "current".
  const skipped = guideProgress({ invoices: [], actions: ["copilot_turn"] });
  assert.equal(skipped.completed, 1);
  assert.equal(skipped.current?.id, "send");
});
