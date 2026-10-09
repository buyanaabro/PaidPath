// Early-payment discount in the PayPal sandbox (PaidPath's approach): a 2% line-item discount;
// paying the discounted amount marks the invoice paid; when the window expires PaidPath removes
// the discount with update_invoicing. (PayPal's conditional-rules API returned 500 in sandbox.)
// Run: npm run smoke:discount   (creates real sandbox invoices)
import { loadEnvConfig } from "@next/env";
import { callPayPalTool } from "../src/lib/paypal";
loadEnvConfig(process.cwd());

const payload = (discount: boolean) => ({
  currency_code: "USD",
  invoice_date: new Date().toISOString().slice(0, 10),
  reference: "PaidPath discount spike",
  note: discount ? "Pay by Oct 16 to keep the 2% early-payment discount." : "Early-payment discount expired.",
  primary_recipients: [{ billing_info: { email_address: process.env.PAYPAL_SANDBOX_BUYER_EMAIL } }],
  items: [
    {
      name: "Design — Designs signed off",
      quantity: "1",
      unit_amount: { currency_code: "USD", value: "2500.00" },
      ...(discount ? { discount: { percent: "2" } } : {}),
    },
  ],
});

const summary = (inv: Record<string, unknown>) =>
  JSON.stringify({ status: inv.status, due: inv.due_amount, amount: (inv.amount as { value?: string })?.value, discount: (inv.amount as { breakdown?: { discount?: unknown } })?.breakdown?.discount });

async function main() {
  for (const scenario of ["pay-in-window", "expire"]) {
    const created = (await callPayPalTool("create_invoice", payload(true))) as { href: string };
    const id = created.href.split("/").pop()!;
    await callPayPalTool("send_invoice", { invoice_id: id, send_to_recipient: true });
    const sent = (await callPayPalTool("get_invoice", { invoice_id: id })) as Record<string, unknown>;
    console.log(`[${scenario}] ${id} sent:`, summary(sent));
    if (scenario === "pay-in-window") {
      await callPayPalTool("record_payment_for_invoice", { invoice_id: id, method: "BANK_TRANSFER", payment_date: new Date().toISOString().slice(0, 10), amount: { currency_code: "USD", value: "2450.00" }, note: "discounted" });
      console.log("  after 2450:", summary((await callPayPalTool("get_invoice", { invoice_id: id })) as Record<string, unknown>));
    } else {
      try {
        const r = await callPayPalTool("update_invoicing", { resource_type: "invoice", invoice_update: { ...payload(false), invoice_id: id, send_to_recipient: true, send_to_invoicer: false } });
        console.log("  update result:", JSON.stringify(r).slice(0, 200));
      } catch (e) {
        console.log("  update FAILED:", String(e).slice(0, 400));
      }
      const after = (await callPayPalTool("get_invoice", { invoice_id: id })) as Record<string, unknown>;
      console.log("  after expiry update:", summary(after), "number", (after.detail as { invoice_number?: string })?.invoice_number);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
