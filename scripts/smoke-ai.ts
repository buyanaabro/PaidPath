// Phase 0 smoke test: Gemini calls a PayPal Agent Toolkit tool via AI SDK v6.
// Run: npm run smoke:ai
import { loadEnvConfig } from "@next/env";
import { generateText, stepCountIs } from "ai";
import { getModel } from "../src/lib/ai";
import { getPayPalTools } from "../src/lib/paypal";

loadEnvConfig(process.cwd());

async function main() {
  const { text, steps } = await generateText({
    model: getModel(),
    tools: getPayPalTools(),
    stopWhen: stepCountIs(4),
    prompt:
      "List my 5 most recent PayPal invoices and summarize their statuses in one sentence.",
  });

  const toolCalls = steps.flatMap((step) => step.toolCalls.map((c) => c.toolName));
  console.log("tool calls →", toolCalls);
  console.log("answer →", text);
  if (!toolCalls.includes("list_invoices")) {
    throw new Error("Model did not call list_invoices");
  }
  console.log("\nAI_SMOKE_OK");
}

main().catch((error) => {
  console.error("AI_SMOKE_FAILED", error.message ?? error);
  process.exit(1);
});
