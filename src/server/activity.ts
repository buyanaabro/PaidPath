import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentLog, invoices, tasks, type AgentActor } from "@/db/schema";
import { formatMoney } from "@/lib/format";

export type ActivityItem = {
  id: number;
  ts: string;
  actor: AgentActor;
  action: string;
  summary: string;
  durationMs: number | null;
  ok: boolean;
};

const parse = (json: string | null): Record<string, unknown> => {
  try {
    return (JSON.parse(json ?? "null") as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
};
const bare = (name: string) => name.replace(/^Milestone:\s*/i, "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Agent log rows for one project, newest first, with a human summary (no raw payloads). */
export function listActivity(db: Db, projectId: number, options: { afterId?: number; limit?: number } = {}): ActivityItem[] {
  const rows = db
    .select()
    .from(agentLog)
    .where(and(eq(agentLog.projectId, projectId), options.afterId ? gt(agentLog.id, options.afterId) : undefined))
    .orderBy(desc(agentLog.id))
    .limit(Math.min(options.limit ?? 50, 200))
    .all();
  const invoiceRows = new Map(
    db.select().from(invoices).where(eq(invoices.projectId, projectId)).all().map((i) => [i.id, i]),
  );
  const taskNames = new Map(
    db.select({ id: tasks.id, name: tasks.name }).from(tasks).where(eq(tasks.projectId, projectId)).all().map((t) => [t.id, bare(t.name)]),
  );
  const invoiceLabel = (id: unknown) => {
    const invoice = invoiceRows.get(Number(id));
    return invoice ? `#${invoice.invoiceNumber ?? "?"} (${bare(invoice.milestoneName)})` : "an invoice";
  };

  return rows.map((row) => {
    const payload = parse(row.payloadJson);
    const result = parse(row.resultJson);
    const failed = row.ok ? "" : " — failed";
    const summary = (() => {
      switch (row.action) {
        case "create_plan":
          return `Drafted the plan with AI (${plural(Number(result.phases ?? 0), "phase")}, ${String(result.model ?? "fallback")})`;
        case "regenerate_plan":
          return `Regenerated the plan${payload.feedback ? `: “${String(payload.feedback).slice(0, 80)}”` : ""}`;
        case "invoice_milestone":
          return `Sent PayPal invoice for “${taskNames.get(Number(payload.taskId)) ?? "a milestone"}”${
            payload.amountCents ? ` (${formatMoney(Number(payload.amountCents))})` : ""
          }${result.noteSource ? `, ${result.noteSource === "ai" ? "AI-written" : "template"} note` : ""}${
            (payload.discount as { percent?: number } | null)?.percent
              ? `, ${(payload.discount as { percent: number }).percent}% early-payment discount until ${String((payload.discount as { until?: string }).until)}`
              : ""
          }`;
        case "send_reminder":
          return `Sent payment reminder ${result.reminderCount ? `#${result.reminderCount} ` : ""}for ${invoiceLabel(payload.invoiceId)}${
            payload.noteSource === "copilot" ? ", note written by the copilot" : ""
          }`;
        case "record_payment":
          return `Recorded a sandbox payment for ${invoiceLabel(payload.invoiceId)}${
            result.discountTaken && result.paidCents ? ` — ${formatMoney(Number(result.paidCents))}, early-payment discount taken` : ""
          }`;
        case "discount_expired":
          return `Discount window closed for ${invoiceLabel(payload.invoiceId)} — PayPal invoice updated to ${
            result.amountCents ? formatMoney(Number(result.amountCents)) : "the full amount"
          }`;
        case "portal_viewed":
          return "Client opened the project portal";
        case "portal_link_rotated":
          return "Client portal link replaced — the old link no longer works";
        case "invoice_status_changed":
          return `PayPal reports ${invoiceLabel(payload.invoiceId)} is now ${String(result.to ?? "updated")}`;
        case "clock_changed":
          return payload.to ? `Demo clock set to ${String(payload.to)}` : "Demo clock reset to the real date";
        case "copilot_turn": {
          const calls = Array.isArray(result.calls) ? (result.calls as string[]) : [];
          if (!row.ok) return `Copilot request failed (${String(payload.model ?? "no model")})`;
          return calls.length ? `Copilot called ${calls.join(", ")}` : "Copilot answered";
        }
        default:
          return row.action.replace(/_/g, " ");
      }
    })();
    return {
      id: row.id,
      ts: row.ts,
      actor: row.actor,
      action: row.action,
      summary: row.action === "copilot_turn" ? summary : summary + failed,
      durationMs: row.durationMs,
      ok: row.ok,
    };
  });
}
