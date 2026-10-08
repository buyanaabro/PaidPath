// Full invoice lifecycle against the PayPal sandbox:
// create → send → get → QR → record payment → get (expects PAID).
// Run: npm run smoke:invoice-flow   (creates a real sandbox invoice)
import { loadEnvConfig } from "@next/env";
import { callPayPalTool } from "../src/lib/paypal";

loadEnvConfig(process.cwd());

type Invoice = {
  id: string;
  status: string;
  detail: { invoice_number?: string; metadata?: { recipient_view_url?: string; invoicer_view_url?: string } };
  due_amount?: { currency_code: string; value: string };
};

const time = async <T>(label: string, fn: () => Promise<T>) => {
  const started = Date.now();
  const result = await fn();
  console.log(`✓ ${label} (${Date.now() - started}ms)`);
  return result;
};

const describe = (value: unknown) =>
  typeof value === "string"
    ? `string(${value.length}) ${value.slice(0, 60)}…`
    : JSON.stringify(value, (k, v) => (typeof v === "string" && v.length > 80 ? `${v.slice(0, 60)}…(${v.length})` : v)).slice(0, 400);

async function main() {
  const recipient = process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "client@example.com";
  const created = (await time("create_invoice", () =>
    callPayPalTool("create_invoice", {
      currency_code: "USD",
      note: "PaidPath invoice-flow smoke test",
      reference: "PaidPath smoke",
      primary_recipients: [{ billing_info: { email_address: recipient } }],
      items: [{ name: "Design — Milestone: Designs signed off", quantity: "1", unit_amount: { currency_code: "USD", value: "2500.00" } }],
    }),
  )) as { href: string };
  const invoiceId = created.href.split("/").pop()!;
  console.log("  invoice id:", invoiceId);

  const sent = await time("send_invoice", () =>
    callPayPalTool("send_invoice", { invoice_id: invoiceId, send_to_recipient: true }),
  );
  console.log("  send result:", describe(sent));

  const afterSend = (await time("get_invoice", () =>
    callPayPalTool("get_invoice", { invoice_id: invoiceId }),
  )) as Invoice;
  console.log("  status:", afterSend.status, "number:", afterSend.detail.invoice_number);
  console.log("  pay url:", afterSend.detail.metadata?.recipient_view_url);

  const qr = await time("generate_invoice_qr_code", () =>
    callPayPalTool("generate_invoice_qr_code", { invoice_id: invoiceId, width: 240, height: 240 }),
  );
  console.log("  qr result:", typeof qr, describe(qr));

  const reminder = await time("send_invoice_reminder", () =>
    callPayPalTool("send_invoice_reminder", { invoice_id: invoiceId, note: "Friendly reminder from PaidPath smoke test" }),
  );
  console.log("  reminder result:", describe(reminder));

  const paid = await time("record_payment_for_invoice", () =>
    callPayPalTool("record_payment_for_invoice", {
      invoice_id: invoiceId,
      method: "BANK_TRANSFER",
      payment_date: new Date().toISOString().slice(0, 10),
      amount: afterSend.due_amount ?? { currency_code: "USD", value: "2500.00" },
      note: "Sandbox demo payment recorded in PaidPath",
    }),
  );
  console.log("  record payment result:", describe(paid));

  const final = (await time("get_invoice", () =>
    callPayPalTool("get_invoice", { invoice_id: invoiceId }),
  )) as Invoice;
  console.log("  final status:", final.status);
  if (!["PAID", "MARKED_AS_PAID"].includes(final.status)) throw new Error(`Expected PAID, got ${final.status}`);
  console.log("\nINVOICE_FLOW_OK");
}

main().catch((error) => {
  console.error("INVOICE_FLOW_FAILED", error.message ?? error);
  process.exit(1);
});
