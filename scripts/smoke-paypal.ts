// Phase 0 smoke test: create a draft invoice in the PayPal sandbox through the
// Agent Toolkit's tool layer (no LLM involved), then read it back.
// Run: npm run smoke:paypal
import { loadEnvConfig } from "@next/env";
import { callPayPalTool } from "../src/lib/paypal";

loadEnvConfig(process.cwd());

async function main() {
  const recipient =
    process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "client@example.com";

  const created = await callPayPalTool("create_invoice", {
    currency_code: "USD",
    note: "PaidPath smoke test — milestone: Direction approved",
    primary_recipients: [{ billing_info: { email_address: recipient } }],
    items: [
      {
        name: "Milestone: Direction approved",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "1500.00" },
      },
    ],
  });
  console.log("create_invoice →", JSON.stringify(created, null, 2));

  const listed = await callPayPalTool("list_invoices", { page: 1, page_size: 5 });
  console.log("list_invoices →", JSON.stringify(listed, null, 2).slice(0, 1500));
  console.log("\nPAYPAL_SMOKE_OK");
}

main().catch((error) => {
  console.error("PAYPAL_SMOKE_FAILED", error.message ?? error);
  process.exit(1);
});
