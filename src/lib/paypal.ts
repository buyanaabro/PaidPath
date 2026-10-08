import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { requireEnv } from "./env";

// Curated subset: a small, focused tool surface keeps LLM tool-calling reliable.
export const PAYPAL_ACTIONS = {
  invoices: {
    create: true,
    list: true,
    get: true,
    send: true,
    sendReminder: true,
    generateQRC: true,
    recordPayment: true,
  },
  transactions: { list: true },
  insights: { get: true },
};

export function createPayPalToolkit() {
  return new PayPalAgentToolkit({
    clientId: requireEnv("PAYPAL_CLIENT_ID"),
    clientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    configuration: {
      actions: PAYPAL_ACTIONS,
      context: { sandbox: process.env.PAYPAL_ENVIRONMENT !== "PRODUCTION" },
    },
  });
}
