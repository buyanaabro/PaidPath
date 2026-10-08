import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildInvoicePayload, centsToValue, extractQrPng } from "./payload";
import { templateNote } from "./note";
import { toAppStatus, toTaskInvoiceStatus } from "./status";

describe("status mapping", () => {
  test("maps PayPal statuses to app statuses", () => {
    const cases: [string, string][] = [
      ["DRAFT", "draft"],
      ["SENT", "sent"],
      ["UNPAID", "sent"],
      ["PAYMENT_PENDING", "sent"],
      ["PARTIALLY_PAID", "sent"],
      ["PAID", "paid"],
      ["MARKED_AS_PAID", "paid"],
      ["CANCELLED", "cancelled"],
      ["REFUNDED", "refunded"],
      ["something_new", "sent"],
    ];
    for (const [paypal, app] of cases) assert.equal(toAppStatus(paypal), app, paypal);
  });

  test("mirrors onto the task the way the Gantt expects", () => {
    assert.equal(toTaskInvoiceStatus("draft"), "none");
    assert.equal(toTaskInvoiceStatus("refunded"), "cancelled");
    assert.equal(toTaskInvoiceStatus("paid"), "paid");
  });
});

describe("buildInvoicePayload", () => {
  const payload = buildInvoicePayload({
    projectId: 3,
    projectName: "Aurora Coffee — brand site",
    clientEmail: "buyer@example.com",
    clientName: "Aurora Coffee",
    currency: "USD",
    taskId: 42,
    phaseName: "Design",
    milestoneName: "Milestone: Designs signed off",
    amountCents: 250_000,
    note: "Thanks!",
    invoiceDate: "2026-11-20",
  });

  test("formats amounts as 2-decimal strings", () => {
    assert.equal(centsToValue(250_000), "2500.00");
    assert.equal(centsToValue(12_345), "123.45");
    assert.deepEqual(payload.items[0].unit_amount, { currency_code: "USD", value: "2500.00" });
  });

  test("addresses the client and names the line item after the phase milestone", () => {
    assert.equal(payload.primary_recipients[0].billing_info.email_address, "buyer@example.com");
    assert.equal(payload.items[0].name, "Design — Designs signed off");
    assert.equal(payload.items[0].quantity, "1");
    assert.equal(payload.reference, "PaidPath #3/42");
    assert.equal(payload.invoice_date, "2026-11-20");
  });
});

describe("extractQrPng", () => {
  test("pulls the base64 PNG out of the multipart body", () => {
    const raw =
      '--abc\r\nContent-Disposition: form-data; name="image"\r\nContent-Type: text/plain\r\n\r\niVBORw0KGgoAAAANSUhEUg==\r\n--abc--';
    assert.equal(extractQrPng(raw), "iVBORw0KGgoAAAANSUhEUg==");
  });

  test("rejects anything that is not a PNG", () => {
    assert.equal(extractQrPng(""), null);
    assert.equal(extractQrPng({ ok: true }), null);
    assert.equal(extractQrPng("--abc\r\n\r\nnot-an-image\r\n--abc--"), null);
  });
});

test("template note mentions the milestone, deliverables and PayPal", () => {
  const note = templateNote({
    projectName: "Aurora",
    clientName: "Aurora Coffee",
    phaseName: "Design",
    milestoneName: "Milestone: Designs signed off",
    deliverables: ["Wireframes", "Mockups"],
    amountLabel: "$2,500",
  });
  assert.match(note, /Designs signed off/);
  assert.match(note, /Wireframes, Mockups/);
  assert.match(note, /PayPal/);
});
