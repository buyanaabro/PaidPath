import { AIHelper, MessageDialog, ProjectModel, StringHelper, type Model } from "@bryntum/gantt";
import { PaidTaskModel } from "@/components/gantt/PaidTaskModel";
import { applyPaymentGates, gateInputFor, type GateContext } from "@/components/gantt/payment-gates";
import type { InvoicesSnapshot } from "@/components/invoices/useInvoices";
import type { ClockState } from "@/components/workspace/DemoClock";
import { formatDate, formatMoney } from "@/lib/format";
import { addDays, daysBetween, expectedPayment, localIsoDate, toIsoDate } from "@/lib/gates";
import type { InvoiceView } from "@/server/invoicing/service";

type Tool = ReturnType<typeof AIHelper.createBasicTool>;

/** Live workspace state the copilot tools read and update. */
export type CopilotEnv = {
  projectId: number;
  canAct: boolean;
  client: { name: string; email: string };
  termsDays: number;
  project: ProjectModel | undefined;
  gate: GateContext;
  onSnapshot: (snapshot: InvoicesSnapshot) => void;
  onClock: (clock: ClockState, snapshot: InvoicesSnapshot) => void;
};

const ACTOR = { "x-paidpath-actor": "copilot" };
const bareName = (name: string) => name.replace(/^Milestone:\s*/i, "");
const norm = (value: string) => bareName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const money = (cents: number) => formatMoney(cents);

/** User confirmation for every copilot write action (deterministic, not LLM-driven). */
async function confirm(title: string, lines: string[], okButton: string) {
  const choice = await MessageDialog.confirm({
    title,
    message: lines.map((line) => `<p class="pp-confirm-line">${StringHelper.encodeHtml(line)}</p>`).join(""),
    okButton,
    cancelButton: "Cancel",
  });
  return choice === MessageDialog.okButton;
}
const declined = () => AIHelper.error("The user declined. Nothing was changed — do not retry unless asked.");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message ?? `Request failed (${response.status})`);
  return body as T;
}
const post = <T>(url: string, body?: unknown) =>
  api<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...ACTOR },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function pricedMilestones(project: ProjectModel | undefined) {
  return (project?.taskStore.query((t: Model) => (t as PaidTaskModel).isMilestone && Boolean((t as PaidTaskModel).amount)) ??
    []) as PaidTaskModel[];
}

/** Resolves a milestone by (partial) name, or explains which names exist. */
function findMilestone(project: ProjectModel | undefined, query: string) {
  const all = pricedMilestones(project);
  const q = norm(query);
  const match = all.find((t) => norm(t.name) === q) ?? all.find((t) => norm(t.name).includes(q) || q.includes(norm(t.name)));
  return match
    ? { task: match }
    : { error: `No priced milestone matches "${query}". Milestones: ${all.map((t) => `"${bareName(t.name)}"`).join(", ")}.` };
}

async function findInvoice(env: CopilotEnv, query: string) {
  const { invoices } = await api<InvoicesSnapshot>(`/api/projects/${env.projectId}/invoices`);
  const live = invoices.filter((i) => i.status !== "cancelled");
  const q = query.replace(/^#/, "").trim();
  const match =
    live.find((i) => i.invoiceNumber === q || i.invoiceNumber?.replace(/^0+/, "") === q.replace(/^0+/, "")) ??
    live.find((i) => norm(i.milestoneName).includes(norm(q)));
  return match
    ? { invoice: match }
    : { error: `No invoice matches "${query}". Invoices: ${live.map((i) => `#${i.invoiceNumber} "${bareName(i.milestoneName)}" (${i.status})`).join(", ") || "none"}.` };
}

const actionGuard = (env: CopilotEnv) => (env.canAct ? null : AIHelper.error("This plan is still a draft — accept it before sending invoices or changing the clock."));

/**
 * Runs the payment gates on a headless copy of the plan with a hypothetical payment date.
 * The live Gantt is never touched.
 */
async function simulatePayment(env: CopilotEnv, milestone: PaidTaskModel, days: number) {
  const live = env.project!;
  const sim = new ProjectModel({ taskModelClass: PaidTaskModel, startDate: live.startDate });
  await sim.loadInlineData({
    calendars: live.calendarManagerStore.toJSON(),
    tasks: live.taskStore.toJSON(),
    dependencies: live.dependencyStore.toJSON(),
  });
  try {
    const current = await applyPaymentGates(sim, env.gate);
    const phaseStarts = () =>
      new Map(
        (sim.taskStore.query((t: Model) => !(t as PaidTaskModel).isLeaf) as PaidTaskModel[])
          .filter((t) => t.startDate)
          .map((t) => [t.name, localIsoDate(t.startDate as Date)]),
      );
    const before = phaseStarts();
    const expected = expectedPayment(gateInputFor(milestone, env.gate)).date;
    const paidAt = addDays(expected, days);
    const invoicesByTask = new Map(env.gate.invoicesByTask);
    invoicesByTask.set(Number(milestone.id), { status: "paid", dueAt: null, paidAt });
    const after = await applyPaymentGates(sim, { ...env.gate, invoicesByTask });
    const phasesMoved = [...phaseStarts()]
      .filter(([name, start]) => before.get(name) !== start)
      .map(([name, start]) => ({ phase: name, startNow: before.get(name), startInScenario: start }));
    const delta = current.finishAfter && after.finishAfter ? daysBetween(current.finishAfter, after.finishAfter) : null;
    return { expected, paidAt, finishNow: current.finishAfter, finishInScenario: after.finishAfter, delta, phasesMoved };
  } finally {
    sim.destroy();
  }
}

export function createCopilotTools(getEnv: () => CopilotEnv): Record<string, Tool> {
  return {
    whatIfPaymentDelay: AIHelper.createBasicTool({
      description:
        "Simulates the client paying a milestone's invoice N days later (negative = earlier) than currently expected, using PaidPath's payment-gate rules on a copy of the plan. Returns the projected finish change and which phases move. Never changes the plan.",
      available: true,
      properties: {
        milestone: { type: "string", description: "Milestone name, e.g. 'Designs signed off'" },
        days: { type: "number", description: "Days later than expected (negative for earlier)" },
      },
      required: ["milestone", "days"],
      async fn({ args }) {
        const env = getEnv();
        const { milestone, days } = args as { milestone: string; days: number };
        const found = findMilestone(env.project, milestone);
        if (!found.task) return AIHelper.error(found.error!);
        const invoice = env.gate.invoicesByTask.get(Number(found.task.id));
        if (invoice?.status === "paid") return AIHelper.error(`"${bareName(found.task.name)}" is already paid.`);
        if (!found.task.paymentGate) {
          return AIHelper.result({
            milestone: bareName(found.task.name),
            paymentGate: false,
            note: "This milestone is not a payment gate, so a late payment only delays cash, not the schedule.",
          });
        }
        const sim = await simulatePayment(env, found.task, Math.round(Number(days) || 0));
        return AIHelper.result(
          {
            milestone: bareName(found.task.name),
            amount: money(Math.round((found.task.amount ?? 0) * 100)),
            paymentExpectedNow: sim.expected,
            paymentInScenario: sim.paidAt,
            projectedFinishNow: sim.finishNow,
            projectedFinishInScenario: sim.finishInScenario,
            finishChangeDays: sim.delta,
            phasesMoved: sim.phasesMoved,
            note: "Simulation only — the live plan is unchanged.",
          },
          "What-if simulated",
        );
      },
    }),

    getPayPalActivity: AIHelper.createBasicTool({
      description:
        "Fetches recent transactions from the seller's PayPal account (PayPal Transaction Search): payments received, balance. Use for questions about actual money movements in PayPal.",
      available: true,
      properties: { days: { type: "number", description: "How many days back (1-31, default 30)" } },
      async fn({ args }) {
        const { days } = args as { days?: number };
        try {
          return AIHelper.result(await api(`/api/projects/${getEnv().projectId}/paypal/activity?days=${Number(days) || 30}`));
        } catch (error) {
          return AIHelper.error(String(error instanceof Error ? error.message : error));
        }
      },
    }),

    sendInvoice: AIHelper.createBasicTool({
      description:
        "Creates and sends the real PayPal (sandbox) invoice for a priced milestone to the client. The user must confirm.",
      available: true,
      properties: { milestone: { type: "string", description: "Milestone name to invoice" } },
      required: ["milestone"],
      async fn({ args }) {
        const env = getEnv();
        const guard = actionGuard(env);
        if (guard) return guard;
        const found = findMilestone(env.project, (args as { milestone: string }).milestone);
        if (!found.task) return AIHelper.error(found.error!);
        const task = found.task;
        if (!["none", "cancelled"].includes(task.invoiceStatus)) {
          return AIHelper.error(`"${bareName(task.name)}" already has a ${task.invoiceStatus} invoice.`);
        }
        const amount = money(Math.round((task.amount ?? 0) * 100));
        const ok = await confirm(
          "Send PayPal invoice?",
          [
            `${bareName(task.name)} — ${amount}`,
            `To ${env.client.name} <${env.client.email}>, due in ${env.termsDays} days.`,
            "PaidPath drafts a short note with AI and sends the invoice through PayPal (sandbox).",
          ],
          "Send invoice",
        );
        if (!ok) return declined();
        try {
          const result = await post<InvoicesSnapshot & { invoice: { id: number } }>(`/api/projects/${env.projectId}/invoices`, { taskId: Number(task.id) });
          env.onSnapshot(result);
          const sent = result.invoices.find((i) => i.id === result.invoice.id);
          return AIHelper.result(
            { invoiceNumber: sent?.invoiceNumber, amount, dueAt: sent?.dueAt ? toIsoDate(sent.dueAt) : null, payUrl: sent?.payUrl },
            "Invoice sent",
          );
        } catch (error) {
          return AIHelper.error(error instanceof Error ? error.message : "Sending failed");
        }
      },
    }),

    sendReminder: AIHelper.createBasicTool({
      description:
        "Sends a PayPal payment reminder for an unpaid invoice. Write `note` yourself (2-3 sentences) with a tone that fits: friendly for a first reminder, firmer after earlier reminders or long lateness, mentioning that the next phase waits for the payment when relevant. The user must confirm.",
      available: true,
      properties: {
        invoice: { type: "string", description: "Milestone name of the invoice (preferred), or its invoice number" },
        note: { type: "string", description: "Reminder message to the client" },
      },
      required: ["invoice"],
      async fn({ args }) {
        const env = getEnv();
        const guard = actionGuard(env);
        if (guard) return guard;
        const { invoice: query, note } = args as { invoice: string; note?: string };
        const found = await findInvoice(env, query);
        if (!found.invoice) return AIHelper.error(found.error!);
        const invoice: InvoiceView = found.invoice;
        if (invoice.status !== "sent") return AIHelper.error(`Invoice #${invoice.invoiceNumber} is ${invoice.status}, not awaiting payment.`);
        const ok = await confirm(
          "Send payment reminder?",
          [
            `Invoice #${invoice.invoiceNumber} — ${bareName(invoice.milestoneName)}, ${money(invoice.amountCents)}${invoice.overdue ? " (overdue)" : ""}`,
            `Reminders sent so far: ${invoice.reminderCount}`,
            note?.trim() ? `Note: “${note.trim()}”` : "Note: PaidPath's reminder template (tone escalates with each reminder).",
          ],
          "Send reminder",
        );
        if (!ok) return declined();
        try {
          env.onSnapshot(await post(`/api/projects/${env.projectId}/invoices/${invoice.id}/remind`, { note }));
          return AIHelper.result({ invoiceNumber: invoice.invoiceNumber, remindersSent: invoice.reminderCount + 1 }, "Reminder sent");
        } catch (error) {
          return AIHelper.error(error instanceof Error ? error.message : "Reminder failed");
        }
      },
    }),

    recordPayment: AIHelper.createBasicTool({
      description:
        "Sandbox demo only: records that the client paid an invoice in full (PayPal marks it paid). The user must confirm.",
      available: true,
      properties: { invoice: { type: "string", description: "Milestone name of the invoice (preferred), or its invoice number" } },
      required: ["invoice"],
      async fn({ args }) {
        const env = getEnv();
        const guard = actionGuard(env);
        if (guard) return guard;
        const found = await findInvoice(env, (args as { invoice: string }).invoice);
        if (!found.invoice) return AIHelper.error(found.error!);
        const invoice = found.invoice;
        if (invoice.status !== "sent") return AIHelper.error(`Invoice #${invoice.invoiceNumber} is ${invoice.status}.`);
        const ok = await confirm(
          "Record payment (sandbox)?",
          [`Mark invoice #${invoice.invoiceNumber} — ${bareName(invoice.milestoneName)}, ${money(invoice.amountCents)} as paid in full.`],
          "Record payment",
        );
        if (!ok) return declined();
        try {
          env.onSnapshot(await post(`/api/projects/${env.projectId}/invoices/${invoice.id}/record-payment`));
          return AIHelper.result({ invoiceNumber: invoice.invoiceNumber, status: "paid" }, "Payment recorded");
        } catch (error) {
          return AIHelper.error(error instanceof Error ? error.message : "Recording failed");
        }
      },
    }),

    moveDemoClock: AIHelper.createBasicTool({
      description:
        "Moves the project's demo clock (simulated today) to show how payments landing late or early change the plan. Give `days` to shift, `date` (YYYY-MM-DD) to jump, or `reset: true` for the real date. The user must confirm.",
      available: true,
      properties: {
        days: { type: "number", description: "Days to move forward (negative = back)" },
        date: { type: "string", description: "Target date YYYY-MM-DD" },
        reset: { type: "boolean", description: "Return to the real date" },
      },
      async fn({ args }) {
        const env = getEnv();
        const guard = actionGuard(env);
        if (guard) return guard;
        const { days, date, reset } = args as { days?: number; date?: string; reset?: boolean };
        const today = env.gate.today;
        const body: { today: string | null } | { shiftDays: number } | null = reset
          ? { today: null }
          : date && /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? { today: date }
            : Number.isInteger(Math.round(Number(days))) && Number(days)
              ? { shiftDays: Math.round(Number(days)) }
              : null;
        if (!body) return AIHelper.error("Give days, a YYYY-MM-DD date, or reset: true.");
        const target = "shiftDays" in body ? addDays(today, body.shiftDays) : body.today;
        const ok = await confirm(
          "Move the demo clock?",
          [`From ${formatDate(today)} to ${target ? formatDate(target) : "the real date"}.`, "Overdue invoices and payment holds update immediately."],
          "Move clock",
        );
        if (!ok) return declined();
        try {
          const data = await post<InvoicesSnapshot & { clock: ClockState }>(`/api/projects/${env.projectId}/clock`, body);
          env.onClock(data.clock, data);
          return AIHelper.result({ today: data.clock.today, simulated: data.clock.simulated }, "Clock moved");
        } catch (error) {
          return AIHelper.error(error instanceof Error ? error.message : "Could not move the clock");
        }
      },
    }),
  };
}
