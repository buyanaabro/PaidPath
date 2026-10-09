import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dependencies, tasks } from "@/db/schema";
import { discountView } from "@/lib/discount";
import { formatMoney } from "@/lib/format";
import { daysBetween, toIsoDate } from "@/lib/gates";
import { isSimulated, projectToday } from "@/server/clock";
import { listProjectInvoices } from "@/server/invoicing/service";
import { ensureShareToken, portalPath } from "@/server/portal";
import { getProject } from "@/server/projects";

const latest = (dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => Boolean(d)).map(toIsoDate).sort().at(-1) ?? null;

function baselineEnds(json: string | null) {
  try {
    const list = JSON.parse(json ?? "[]") as { endDate?: string }[];
    return Array.isArray(list) ? list.map((b) => b.endDate) : [];
  } catch {
    return [];
  }
}

/**
 * Compact, authoritative project snapshot appended to the copilot's system prompt so that
 * money and schedule questions can be answered without tool round-trips (free-tier budget).
 */
export function buildCopilotContext(
  db: Db,
  projectId: number,
  now = new Date(),
  options: { baseUrl?: string } = {},
): string | null {
  const project = getProject(db, projectId);
  if (!project) return null;
  const today = projectToday(project, now);
  const rows = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
  const ledger = listProjectInvoices(db, projectId, now).filter((i) => i.status !== "cancelled");
  const money = (cents: number) => formatMoney(cents, project.currency);

  const priced = rows.filter((t) => t.amountCents && t.duration === 0);
  const invoicedTaskIds = new Set(ledger.map((i) => i.taskId));
  const contract = priced.reduce((sum, t) => sum + (t.amountCents ?? 0), 0);
  const paid = ledger.filter((i) => i.status === "paid").reduce((s, i) => s + (i.paidAmountCents ?? i.amountCents), 0);
  const open = ledger.filter((i) => i.status !== "paid");
  const outstanding = open.reduce((s, i) => s + i.amountCents, 0);
  const overdue = open.filter((i) => i.overdue).reduce((s, i) => s + i.amountCents, 0);

  const finish = latest(rows.map((t) => t.endDate));
  const baseline = latest(rows.flatMap((t) => baselineEnds(t.baselines)));
  const drift = finish && baseline ? daysBetween(baseline, finish) : null;
  const byId = new Map(rows.map((t) => [t.id, t]));
  const links = db.select().from(dependencies).where(eq(dependencies.projectId, projectId)).all();
  const gates = priced.filter((t) => t.paymentGate);
  const unlocks = (gate: (typeof rows)[number]) =>
    links.filter((l) => l.fromTaskId === gate.id).map((l) => byId.get(l.toTaskId)).filter((t) => t !== undefined);
  const gateLines = gates.map((gate) => {
    const next = unlocks(gate);
    const held = next.filter((t) => t.gateHold);
    return `- "${gate.name.replace(/^Milestone:\s*/i, "")}" gates ${next.map((t) => `"${t.name}"`).join(", ") || "nothing"}${
      held.length ? ` — currently held until ${held[0].gateHold} waiting for this payment` : " — not holding anything now"
    }`;
  });

  const invoiceLines = ledger.map((i) => {
    const due = i.dueAt ? toIsoDate(i.dueAt) : null;
    const state =
      i.status === "paid"
        ? `PAID ${i.paidAt ? toIsoDate(i.paidAt) : ""}`
        : i.overdue && due
          ? `OVERDUE by ${daysBetween(due, today)} days (due ${due})`
          : `awaiting payment, due ${due ?? "?"}`;
    const discount = discountView(i, today);
    const discountNote = !discount
      ? ""
      : discount.state === "active"
        ? `, early-payment discount ${discount.percent}% (${money(discount.savingsCents)}) until ${discount.until}`
        : discount.state === "taken"
          ? `, paid ${money(i.paidAmountCents ?? i.amountCents)} with the ${discount.percent}% early-payment discount`
          : `, ${discount.percent}% early-payment discount ${discount.state === "missed" ? "not used" : `expired ${discount.until}`}`;
    return `- Invoice #${i.invoiceNumber ?? "?"} "${i.milestoneName.replace(/^Milestone:\s*/i, "")}" ${money(i.amountCents)} — sent ${i.sentAt ? toIsoDate(i.sentAt) : "?"}, ${state}, reminders sent: ${i.reminderCount}${discountNote}`;
  });
  const uninvoiced = priced
    .filter((t) => !invoicedTaskIds.has(t.id))
    .map(
      (t) =>
        `- "${t.name.replace(/^Milestone:\s*/i, "")}" ${money(t.amountCents ?? 0)} on ${t.endDate ? toIsoDate(t.endDate) : "?"}${t.paymentGate ? " (payment gate)" : ""}`,
    );

  return [
    "## PaidPath context (authoritative; refreshed on every message)",
    `You are PaidPath Copilot, helping a freelancer run the project "${project.name}" for client ${project.clientName} <${project.clientEmail}>. Status: ${project.status}.`,
    `Today is ${today}${isSimulated(project) ? " (demo clock — simulated date)" : ""}. Payment terms: ${project.paymentTermsDays} days.`,
    `Money: contract ${money(contract)}; paid ${money(paid)}; outstanding (invoiced, unpaid) ${money(outstanding)}${overdue ? `, of which ${money(overdue)} overdue` : ""}; not yet invoiced ${money(contract - paid - outstanding)}.`,
    `Schedule: projected finish ${finish ?? "unknown"}${baseline ? `; baseline finish ${baseline}${drift ? ` (${Math.abs(drift)} days ${drift > 0 ? "late" : "early"})` : " (on baseline)"}` : ""}.`,
    "Invoices:",
    ...(invoiceLines.length ? invoiceLines : ["- none sent yet"]),
    "Milestones not invoiced yet:",
    ...(uninvoiced.length ? uninvoiced : ["- none"]),
    ...(options.baseUrl
      ? [`Client portal (read-only timeline + pay buttons, safe to share with the client): ${options.baseUrl}${portalPath(ensureShareToken(db, projectId)!)}`]
      : []),
    "Payment gates (each milestone's payment unlocks only the tasks listed for it):",
    ...(gateLines.length ? gateLines : ["- none"]),
    "",
    "## Rules",
    "- Payment gates: the phase after a payment-gate milestone waits until the client is expected to pay (milestone date + terms, the invoice due date, or the actual payment date). While an invoice is overdue the next phase slips 1 day per day; paying early pulls it in. PaidPath sets these holds automatically.",
    "- Never edit held tasks' dates/constraints, gateHold, amount, invoiceStatus or paymentGate — explain the payment hold instead. Other task edits are fine (the user approves them).",
    "- Answer money and schedule questions from this context directly, without calling tools. Use whatIfPaymentDelay for what-if questions about late or early payment.",
    "- Early-payment discounts: before invoicing a payment-gate milestone on or after its date, you may call suggestEarlyPaymentDiscount and propose the offer it returns (it simulates how much sooner the launch would be). Only pass discountPercent/discountDays to sendInvoice when the user agrees. A discount is a real reduction on the PayPal invoice that PaidPath removes when the window ends.",
    "- To act, use sendInvoice, sendReminder, recordPayment or moveDemoClock. They ask the user to confirm; never claim an action happened unless the tool succeeded. When sending a reminder, write a short note whose tone fits the reminder count and lateness.",
    "- Never invent amounts, dates or invoice numbers. Be brief: 1-4 sentences or a short list.",
  ].join("\n");
}
