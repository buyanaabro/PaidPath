import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { summarizeTransactions, transactionRange } from "./paypal-activity";

describe("PayPal activity", () => {
  test("summarizes transactions newest first with received total and balance", () => {
    const summary = summarizeTransactions({
      transaction_details: [
        {
          transaction_info: {
            transaction_id: "A",
            transaction_initiation_date: "2026-09-29T07:03:19Z",
            transaction_amount: { currency_code: "USD", value: "5000.00" },
            transaction_status: "S",
            transaction_subject: "Initial balance",
            ending_balance: { value: "5000.00" },
          },
        },
        {
          transaction_info: {
            transaction_id: "B",
            transaction_initiation_date: "2026-10-05T10:00:00Z",
            transaction_amount: { currency_code: "USD", value: "1500.00" },
            transaction_status: "P",
            invoice_id: "INV2-X",
          },
          payer_info: { email_address: "client@example.com" },
        },
      ],
      last_refreshed_datetime: "2026-10-09T14:29:59Z",
    });
    assert.equal(summary.count, 2);
    assert.deepEqual(summary.transactions.map((t) => [t.id, t.status]), [["B", "pending"], ["A", "completed"]]);
    assert.equal(summary.receivedTotal, 5000);
    assert.equal(summary.latestBalance, 5000);
    assert.equal(summary.transactions[0].payer, "client@example.com");
    assert.equal(summarizeTransactions({}).count, 0);
  });

  test("clamps the search range to PayPal's 31-day maximum", () => {
    const now = new Date("2026-10-09T12:00:00.500Z");
    assert.deepEqual(transactionRange(90, now), { start_date: "2026-09-08T12:00:00Z", end_date: "2026-10-09T12:00:00Z" });
    assert.equal(transactionRange(0, now).start_date, "2026-09-09T12:00:00Z");
  });
});
