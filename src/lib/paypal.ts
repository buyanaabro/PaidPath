import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { tool, type ToolSet } from "ai";
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
    // Early-payment discounts: PayPal's conditional-rules endpoint returns 500 in sandbox,
    // so the discount is a line-item discount that PaidPath removes (update) when it expires.
    update: true,
  },
  transactions: { list: true },
  insights: { get: true },
};

export class PayPalToolError extends Error {
  constructor(
    readonly toolName: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(`${toolName} failed (${status ?? "?"}): ${message}`);
  }
}

let toolkit: PayPalAgentToolkit | undefined;

function getToolkit() {
  toolkit ??= new PayPalAgentToolkit({
    clientId: requireEnv("PAYPAL_CLIENT_ID"),
    clientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    configuration: {
      actions: PAYPAL_ACTIONS,
      context: { sandbox: process.env.PAYPAL_ENVIRONMENT !== "PRODUCTION" },
    },
  });
  return toolkit;
}

// The toolkit returns JSON strings and reports API failures as { ok: false }
// instead of throwing; normalize both so callers get objects or an exception.
function parseResult(name: string, raw: unknown) {
  const result = typeof raw === "string" ? safeJson(raw) : raw;
  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    const { status, message } = result as { status?: number; message?: string };
    throw new PayPalToolError(name, status, message ?? "Unknown PayPal error");
  }
  return result;
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Deterministic (non-LLM) call to a PayPal toolkit tool. */
export async function callPayPalTool(name: string, args: Record<string, unknown>) {
  const legacy = getToolkit().getTools()[name];
  if (!legacy?.execute) throw new Error(`PayPal tool ${name} is not enabled`);
  const raw = await legacy.execute(args, { toolCallId: `direct-${name}`, messages: [] });
  return parseResult(name, raw);
}

/**
 * The toolkit is built on AI SDK v4 (`parameters`), but Gemini 3 tool-calling needs
 * a current AI SDK (thought-signature round-tripping). Re-wrap each tool for v6.
 */
export function getPayPalTools(): ToolSet {
  return Object.fromEntries(
    Object.entries(getToolkit().getTools()).map(([name, legacy]) => [
      name,
      tool({
        description: legacy.description,
        inputSchema: legacy.parameters,
        execute: async (input, { toolCallId, messages }) => {
          try {
            return parseResult(
              name,
              await legacy.execute!(input, { toolCallId, messages: messages as never }),
            );
          } catch (error) {
            // Surface API errors to the model as data so it can explain/recover.
            if (error instanceof PayPalToolError) {
              return { ok: false, status: error.status, error: error.message };
            }
            throw error;
          }
        },
      }),
    ]),
  );
}
