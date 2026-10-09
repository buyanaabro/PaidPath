import { AIHelper, MessageDialog, StringHelper, type Model, type ProjectModel } from "@bryntum/gantt";
import type { PaidTaskModel } from "@/components/gantt/PaidTaskModel";
import { gateInputFor, type GateContext } from "@/components/gantt/payment-gates";
import { discountBenefit, simulatePayments } from "@/components/gantt/simulate";
import type { InvoicesSnapshot } from "@/components/invoices/useInvoices";
import type { ClockState } from "@/components/workspace/DemoClock";
import {
  discountAmountCents,
  parseDiscountOffer,
  suggestDiscount,
  suggestedWindow,
  type DiscountOffer,
} from "@/lib/discount";
import { formatDate, formatMoney } from "@/lib/format";
import { addDays, expectedPayment, toIsoDate } from "@/lib/gates";
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
        const expected = expectedPayment(gateInputFor(found.task, env.gate)).date;
        const sim = await simulatePayments(env.project!, env.gate, Number(found.task.id), [
          addDays(expected, Math.round(Number(days) || 0)),
        ]);
        const [scenario] = sim.scenarios;
        return AIHelper.result(
          {
            milestone: bareName(found.task.name),
            amount: money(Math.round((found.task.amount ?? 0) * 100)),
            paymentExpectedNow: sim.expected,
            paymentInScenario: scenario.paidAt,
            projectedFinishNow: sim.finishNow,
            projectedFinishInScenario: scenario.finish,
            finishChangeDays: scenario.finishChangeDays,
            phasesMoved: scenario.phasesMoved,
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

    suggestEarlyPaymentDiscount: AIHelper.createBasicTool({
      description:
        "For a milestone that is about to be invoiced: simulates how many days sooner the launch would be if the client paid within the early-payment window instead of on the due date, and returns PaidPath's suggested discount. Changes nothing.",
      available: true,
      properties: { milestone: { type: "string", description: "Milestone name" } },
      required: ["milestone"],
      async fn({ args }) {
        const env = getEnv();
        const found = findMilestone(env.project, (args as { milestone: string }).milestone);
        if (!found.task) return AIHelper.error(found.error!);
        const windowDays = suggestedWindow(env.termsDays);
        if (windowDays === null) return AIHelper.error(`${env.termsDays}-day payment terms are too short for an early-payment discount.`);
        const benefit = await discountBenefit(env.project!, env.gate, Number(found.task.id), windowDays);
        const amountCents = Math.round((found.task.amount ?? 0) * 100);
        const suggestion = suggestDiscount({
          amountCents,
          isGate: found.task.paymentGate,
          launchDaysEarlier: benefit?.launchDaysEarlier ?? null,
          windowDays,
        });
        return AIHelper.result({
          milestone: bareName(found.task.name),
          amount: money(amountCents),
          windowDays,
          launchDaysEarlier: benefit?.launchDaysEarlier ?? null,
          launchIfPaidEarly: benefit?.finishIfEarly ?? null,
          launchIfPaidOnDueDate: benefit?.finishOnDue ?? null,
          recommended: suggestion.recommended,
          suggestedPercent: suggestion.offer.percent,
          suggestedDiscount: money(discountAmountCents(amountCents, suggestion.offer.percent)),
          reason: suggestion.reason,
          note: "Assumes the invoice is sent today. Nothing was changed.",
        });
      },
    }),

    sendInvoice: AIHelper.createBasicTool({
      description:
        "Creates and sends the real PayPal (sandbox) invoice for a priced milestone to the client, optionally with an early-payment discount (only if the user agreed). The user must confirm.",
      available: true,
      properties: {
        milestone: { type: "string", description: "Milestone name to invoice" },
        discountPercent: { type: "number", description: "Optional early-payment discount percent (1-10)" },
        discountDays: { type: "number", description: "Days the discount applies: 3, 7 or 15 (must end before the due date)" },
      },
      required: ["milestone"],
      async fn({ args }) {
        const env = getEnv();
        const guard = actionGuard(env);
        if (guard) return guard;
        const { discountPercent, discountDays } = args as { discountPercent?: number; discountDays?: number };
        let discount: DiscountOffer | null = null;
        try {
          discount = discountPercent ? parseDiscountOffer({ percent: discountPercent, days: discountDays ?? suggestedWindow(env.termsDays) }) : null;
        } catch (error) {
          return AIHelper.error(error instanceof Error ? error.message : "Invalid discount");
        }
        if (discount && discount.days >= env.termsDays) {
          return AIHelper.error(`The discount window must end before the ${env.termsDays}-day due date.`);
        }
        const found = findMilestone(env.project, (args as { milestone: string }).milestone);
        if (!found.task) return AIHelper.error(found.error!);
        const task = found.task;
        if (!["none", "cancelled"].includes(task.invoiceStatus)) {
          return AIHelper.error(`"${bareName(task.name)}" already has a ${task.invoiceStatus} invoice.`);
        }
        const amountCents = Math.round((task.amount ?? 0) * 100);
        const amount = money(amountCents);
        const benefit = discount ? await discountBenefit(env.project!, env.gate, Number(task.id), discount.days) : null;
        const ok = await confirm(
          "Send PayPal invoice?",
          [
            `${bareName(task.name)} — ${amount}`,
            `To ${env.client.name} <${env.client.email}>, due in ${env.termsDays} days.`,
            ...(discount
              ? [
                  `Early-payment discount: ${discount.percent}% (${money(discountAmountCents(amountCents, discount.percent))}) if paid by ${formatDate(addDays(env.gate.today, discount.days))}${
                    benefit && benefit.launchDaysEarlier > 0 ? ` — launch about ${benefit.launchDaysEarlier} days earlier` : ""
                  }.`,
                ]
              : []),
            "PaidPath drafts a short note with AI and sends the invoice through PayPal (sandbox).",
          ],
          "Send invoice",
        );
        if (!ok) return declined();
        try {
          const result = await post<InvoicesSnapshot & { invoice: { id: number } }>(`/api/projects/${env.projectId}/invoices`, {
            taskId: Number(task.id),
            discount,
          });
          env.onSnapshot(result);
          const sent = result.invoices.find((i) => i.id === result.invoice.id);
          return AIHelper.result(
            {
              invoiceNumber: sent?.invoiceNumber,
              amount,
              dueAt: sent?.dueAt ? toIsoDate(sent.dueAt) : null,
              discount: sent?.discountPercent ? { percent: sent.discountPercent, until: sent.discountUntil } : null,
              payUrl: sent?.payUrl,
            },
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
