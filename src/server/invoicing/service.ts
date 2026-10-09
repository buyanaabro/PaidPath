import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { invoices, tasks, type AgentActor, type Invoice } from "@/db/schema";
import {
  DISCOUNT_NOTE_PREFIX,
  discountAmountCents,
  discountEndedLine,
  discountNoteLine,
  type DiscountOffer,
} from "@/lib/discount";
import { formatDate, formatMoney } from "@/lib/format";
import { callPayPalTool, PayPalToolError } from "@/lib/paypal";
import { addDays, daysBetween, toIsoDate } from "@/lib/gates";
import { projectNow, projectToday } from "@/server/clock";
import { ensureShareToken, portalPath } from "@/server/portal";
import { getProject, logAgentRun } from "@/server/projects";
import { draftInvoiceNote, type DraftedNote, type NoteInput } from "./note";
import { buildInvoicePayload, centsToValue, composeNote, extractQrPng, withoutLine } from "./payload";
import { reminderNote, reminderSubject } from "./reminder";
import { blocksNewInvoice, isOpen, toAppStatus, toTaskInvoiceStatus } from "./status";

export type InvoicingDeps = {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  draftNote: (input: NoteInput) => Promise<DraftedNote>;
  now: () => Date;
  /** Who asked for the action (activity feed attribution). Defaults to "user". */
  actor?: Extract<AgentActor, "user" | "copilot">;
  /** Public origin (e.g. https://paidpath.onrender.com) for the client-portal link in notes. */
  baseUrl?: string;
};

export const defaultDeps: InvoicingDeps = {
  callTool: callPayPalTool,
  draftNote: draftInvoiceNote,
  now: () => new Date(),
};

export class InvoicingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Money = { currency_code?: string; value?: string };
type PayPalInvoice = {
  id: string;
  status: string;
  detail?: {
    invoice_number?: string;
    invoice_date?: string;
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string };
  };
  due_amount?: Money;
  payments?: { paid_amount?: Money };
};

const toCents = (money: Money | undefined) => (money?.value ? Math.round(Number(money.value) * 100) : null);

const day = 24 * 60 * 60 * 1000;

function friendly(error: unknown): never {
  if (error instanceof InvoicingError) throw error;
  const detail = error instanceof PayPalToolError ? ` (${error.message})` : "";
  console.error("PayPal invoicing call failed", error);
  throw new InvoicingError(502, `PayPal didn't accept the request. Please try again.${detail}`);
}

function mirrorToTask(db: Db, invoice: Pick<Invoice, "taskId" | "status">) {
  if (!invoice.taskId) return;
  db.update(tasks)
    .set({ invoiceStatus: toTaskInvoiceStatus(invoice.status) })
    .where(eq(tasks.id, invoice.taskId))
    .run();
}

function applyPayPalState(db: Db, invoiceId: number, paypal: PayPalInvoice, now: Date) {
  const status = toAppStatus(paypal.status);
  const current = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()!;
  const updated = db
    .update(invoices)
    .set({
      paypalStatus: paypal.status,
      status,
      invoiceNumber: paypal.detail?.invoice_number ?? current.invoiceNumber,
      payUrl: paypal.detail?.metadata?.recipient_view_url ?? current.payUrl,
      invoicerUrl: paypal.detail?.metadata?.invoicer_view_url ?? current.invoicerUrl,
      paidAt: status === "paid" ? (current.paidAt ?? now.toISOString()) : current.paidAt,
      paidAmountCents: toCents(paypal.payments?.paid_amount) ?? current.paidAmountCents,
    })
    .where(eq(invoices.id, invoiceId))
    .returning()
    .get();
  mirrorToTask(db, updated);
  return { invoice: updated, changed: current.status !== status };
}

/** Phase name + deliverables of a milestone, used for the invoice line item and AI note. */
function phaseOf(db: Db, task: { parentId: number | null } | undefined) {
  const phase = task?.parentId ? db.select().from(tasks).where(eq(tasks.id, task.parentId)).get() : undefined;
  const deliverables = phase
    ? db
        .select({ name: tasks.name, duration: tasks.duration })
        .from(tasks)
        .where(eq(tasks.parentId, phase.id))
        .orderBy(asc(tasks.orderIndex))
        .all()
        .filter((t) => t.duration !== 0)
        .map((t) => t.name)
    : [];
  return { phaseName: phase?.name, deliverables };
}

const portalLine = (db: Db, projectId: number, baseUrl: string | undefined) => {
  const token = baseUrl ? ensureShareToken(db, projectId) : null;
  return token ? `Follow your project's timeline: ${baseUrl}${portalPath(token)}` : null;
};

function getOwnedInvoice(db: Db, projectId: number, invoiceId: number) {
  const invoice = db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.projectId, projectId)))
    .get();
  if (!invoice) throw new InvoicingError(404, "Invoice not found");
  return invoice;
}

/** Creates (or resumes), sends and records the PayPal invoice for a priced milestone. */
export async function invoiceMilestone(
  db: Db,
  projectId: number,
  taskId: number,
  deps: InvoicingDeps = defaultDeps,
  options: { discount?: DiscountOffer | null } = {},
) {
  const started = Date.now();
  const project = getProject(db, projectId);
  if (!project) throw new InvoicingError(404, "Project not found");
  if (project.status !== "active") {
    throw new InvoicingError(409, "Accept the plan before sending invoices.");
  }
  const task = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .get();
  if (!task) throw new InvoicingError(404, "Milestone not found");
  if (task.duration !== 0 || !task.amountCents || task.amountCents <= 0) {
    throw new InvoicingError(400, "Only priced milestones can be invoiced.");
  }

  if (options.discount && options.discount.days >= project.paymentTermsDays) {
    throw new InvoicingError(400, `The discount window must end before the ${project.paymentTermsDays}-day due date.`);
  }

  const existing = db
    .select()
    .from(invoices)
    .where(eq(invoices.taskId, taskId))
    .orderBy(desc(invoices.id))
    .all()
    .find((inv) => blocksNewInvoice(inv.status));
  if (existing && existing.status !== "draft") {
    throw new InvoicingError(409, `This milestone already has a ${existing.status} invoice.`);
  }

  // Invoice dates follow the project clock (demo clock when simulated).
  const now = projectNow(project, deps.now());
  const today = projectToday(project, deps.now());
  const discount = options.discount ?? null;
  try {
    let invoice = existing;
    if (!invoice) {
      const phase = phaseOf(db, task);
      const deliverables = phase.deliverables;
      const phaseName = phase.phaseName ?? project.name;
      const drafted = await deps.draftNote({
        projectName: project.name,
        clientName: project.clientName,
        phaseName,
        milestoneName: task.name,
        deliverables,
        amountLabel: formatMoney(task.amountCents, project.currency),
      });
      const discountUntil = discount ? addDays(today, discount.days) : null;
      const note = composeNote(drafted.note, [
        portalLine(db, projectId, deps.baseUrl),
        discount &&
          discountNoteLine({
            percent: discount.percent,
            untilLabel: formatDate(discountUntil!),
            savingsLabel: formatMoney(discountAmountCents(task.amountCents, discount.percent), project.currency),
          }),
      ]);
      const created = (await deps.callTool(
        "create_invoice",
        buildInvoicePayload({
          projectId,
          projectName: project.name,
          clientEmail: project.clientEmail,
          clientName: project.clientName,
          currency: project.currency,
          taskId,
          phaseName,
          milestoneName: task.name,
          amountCents: task.amountCents,
          note,
          // PayPal needs a real date here; the project clock only drives our own dates.
          invoiceDate: deps.now().toISOString().slice(0, 10),
          discountPercent: discount?.percent,
        }),
      )) as { href?: string; id?: string };
      const paypalInvoiceId = created.id ?? created.href?.split("/").pop();
      if (!paypalInvoiceId) throw new InvoicingError(502, "PayPal did not return an invoice id.");

      // Record the draft immediately so a failed send can be retried without a duplicate.
      invoice = db
        .insert(invoices)
        .values({
          projectId,
          taskId,
          paypalInvoiceId,
          milestoneName: task.name,
          amountCents: task.amountCents,
          currency: project.currency,
          paypalStatus: "DRAFT",
          status: "draft",
          note,
          noteSource: drafted.source,
          discountPercent: discount?.percent ?? null,
          discountDays: discount?.days ?? null,
          discountUntil,
        })
        .returning()
        .get();
    }

    await deps.callTool("send_invoice", {
      invoice_id: invoice.paypalInvoiceId,
      send_to_recipient: true,
    });
    const paypal = (await deps.callTool("get_invoice", {
      invoice_id: invoice.paypalInvoiceId,
    })) as PayPalInvoice;
    const qrPng = await deps
      .callTool("generate_invoice_qr_code", {
        invoice_id: invoice.paypalInvoiceId,
        width: 240,
        height: 240,
      })
      .then(extractQrPng)
      .catch(() => null);

    db.update(invoices)
      .set({
        qrPng,
        sentAt: now.toISOString(),
        dueAt: new Date(now.getTime() + project.paymentTermsDays * day).toISOString(),
      })
      .where(eq(invoices.id, invoice.id))
      .run();
    const { invoice: sent } = applyPayPalState(db, invoice.id, paypal, now);
    db.update(tasks).set({ percentDone: 100 }).where(eq(tasks.id, taskId)).run();

    logAgentRun(db, {
      projectId,
      actor: deps.actor ?? "user",
      action: "invoice_milestone",
      payload: {
        taskId,
        amountCents: task.amountCents,
        resumedDraft: Boolean(existing),
        discount: sent.discountPercent ? { percent: sent.discountPercent, until: sent.discountUntil } : null,
      },
      result: { paypalInvoiceId: sent.paypalInvoiceId, status: sent.paypalStatus, noteSource: sent.noteSource },
      durationMs: Date.now() - started,
      ok: true,
    });
    return sent;
  } catch (error) {
    logAgentRun(db, {
      projectId,
      actor: deps.actor ?? "user",
      action: "invoice_milestone",
      payload: { taskId },
      result: { error: String(error) },
      durationMs: Date.now() - started,
      ok: false,
    });
    friendly(error);
  }
}

/** Pulls the latest PayPal status for every open invoice of a project. */
export async function refreshProjectInvoices(
  db: Db,
  projectId: number,
  deps: InvoicingDeps = defaultDeps,
) {
  const project = getProject(db, projectId);
  if (!project) return 0;
  await expireDiscounts(db, projectId, deps);
  const open = db
    .select()
    .from(invoices)
    .where(eq(invoices.projectId, projectId))
    .all()
    .filter((inv) => isOpen(inv.status))
    .slice(0, 10);
  let changed = 0;
  for (const invoice of open) {
    try {
      const paypal = (await deps.callTool("get_invoice", {
        invoice_id: invoice.paypalInvoiceId,
      })) as PayPalInvoice;
      const result = applyPayPalState(db, invoice.id, paypal, projectNow(project, deps.now()));
      if (result.changed) {
        changed++;
        logAgentRun(db, {
          projectId,
          actor: "automation",
          action: "invoice_status_changed",
          payload: { invoiceId: invoice.id, from: invoice.status },
          result: { to: result.invoice.status, paypalStatus: paypal.status },
          durationMs: 0,
          ok: true,
        });
      }
    } catch (error) {
      console.warn(`Refreshing invoice ${invoice.paypalInvoiceId} failed`, error);
    }
  }
  return changed;
}

/**
 * PaidPath enforces early-payment windows: once the project's today is past `discountUntil`
 * and the invoice is unpaid, the line-item discount is removed on PayPal (the client is
 * notified and now owes the full amount). PayPal's own conditional-rules API fails in sandbox.
 */
export async function expireDiscounts(db: Db, projectId: number, deps: InvoicingDeps = defaultDeps) {
  const project = getProject(db, projectId);
  if (!project) return 0;
  const today = projectToday(project, deps.now());
  const due = db
    .select()
    .from(invoices)
    .where(eq(invoices.projectId, projectId))
    .all()
    .filter((i) => i.status === "sent" && i.discountPercent && !i.discountExpiredAt && i.discountUntil && today > i.discountUntil);
  let expired = 0;
  for (const invoice of due) {
    const started = Date.now();
    try {
      const paypal = (await deps.callTool("get_invoice", { invoice_id: invoice.paypalInvoiceId })) as PayPalInvoice;
      if (toAppStatus(paypal.status) !== "sent") {
        applyPayPalState(db, invoice.id, paypal, projectNow(project, deps.now()));
        continue;
      }
      const task = invoice.taskId ? db.select().from(tasks).where(eq(tasks.id, invoice.taskId)).get() : undefined;
      const note = composeNote(withoutLine(invoice.note ?? "", DISCOUNT_NOTE_PREFIX), [
        discountEndedLine(formatDate(invoice.discountUntil!)),
      ]);
      await deps.callTool("update_invoicing", {
        resource_type: "invoice",
        invoice_update: {
          ...buildInvoicePayload({
            projectId,
            projectName: project.name,
            clientEmail: project.clientEmail,
            clientName: project.clientName,
            currency: invoice.currency,
            taskId: invoice.taskId ?? 0,
            phaseName: phaseOf(db, task).phaseName ?? project.name,
            milestoneName: invoice.milestoneName,
            amountCents: invoice.amountCents,
            note,
            invoiceDate: paypal.detail?.invoice_date ?? deps.now().toISOString().slice(0, 10),
            discountPercent: null,
          }),
          invoice_id: invoice.paypalInvoiceId,
          send_to_recipient: true,
          send_to_invoicer: false,
        },
      });
      db.update(invoices)
        .set({ discountExpiredAt: projectNow(project, deps.now()).toISOString(), note })
        .where(eq(invoices.id, invoice.id))
        .run();
      expired++;
      logAgentRun(db, {
        projectId,
        actor: "automation",
        action: "discount_expired",
        payload: { invoiceId: invoice.id, until: invoice.discountUntil },
        result: { amountCents: invoice.amountCents },
        durationMs: Date.now() - started,
        ok: true,
      });
    } catch (error) {
      console.warn(`Expiring the discount on ${invoice.paypalInvoiceId} failed`, error);
      logAgentRun(db, {
        projectId,
        actor: "automation",
        action: "discount_expired",
        payload: { invoiceId: invoice.id },
        result: { error: String(error) },
        durationMs: Date.now() - started,
        ok: false,
      });
    }
  }
  return expired;
}

export async function remindInvoice(
  db: Db,
  projectId: number,
  invoiceId: number,
  deps: InvoicingDeps = defaultDeps,
  options: { note?: string | null } = {},
) {
  const started = Date.now();
  const invoice = getOwnedInvoice(db, projectId, invoiceId);
  if (!isOpen(invoice.status)) throw new InvoicingError(409, "Only unpaid invoices can be reminded.");
  const project = getProject(db, projectId)!;
  const due = invoice.dueAt ? toIsoDate(invoice.dueAt) : null;
  const reminder = {
    reminderCount: invoice.reminderCount,
    daysOverdue: due ? daysBetween(due, projectToday(project, deps.now())) : 0,
    amount: formatMoney(invoice.amountCents, invoice.currency),
    milestone: invoice.milestoneName.replace(/^Milestone:\s*/i, ""),
    projectName: project.name,
  };
  const note = reminderNote(reminder, options.note);
  try {
    await deps.callTool("send_invoice_reminder", {
      invoice_id: invoice.paypalInvoiceId,
      subject: reminderSubject(reminder),
      note,
    });
  } catch (error) {
    friendly(error);
  }
  const updated = db
    .update(invoices)
    .set({ reminderCount: invoice.reminderCount + 1, lastReminderAt: projectNow(project, deps.now()).toISOString() })
    .where(eq(invoices.id, invoiceId))
    .returning()
    .get();
  logAgentRun(db, {
    projectId,
    actor: deps.actor ?? "user",
    action: "send_reminder",
    payload: { invoiceId, noteSource: options.note?.trim() ? "copilot" : "template" },
    result: { reminderCount: updated.reminderCount, note },
    durationMs: Date.now() - started,
    ok: true,
  });
  return updated;
}

/** Sandbox demo: records a full manual payment so PayPal marks the invoice paid. */
export async function recordDemoPayment(
  db: Db,
  projectId: number,
  invoiceId: number,
  deps: InvoicingDeps = defaultDeps,
) {
  const started = Date.now();
  const invoice = getOwnedInvoice(db, projectId, invoiceId);
  if (!isOpen(invoice.status)) throw new InvoicingError(409, "This invoice is not awaiting payment.");
  const project = getProject(db, projectId)!;
  const now = projectNow(project, deps.now());
  try {
    // Pay what PayPal currently asks for (less while an early-payment discount is active).
    const before = (await deps.callTool("get_invoice", { invoice_id: invoice.paypalInvoiceId })) as PayPalInvoice;
    const dueCents = toCents(before.due_amount) ?? invoice.amountCents;
    await deps.callTool("record_payment_for_invoice", {
      invoice_id: invoice.paypalInvoiceId,
      method: "BANK_TRANSFER",
      // PayPal rejects future payment dates, so report the real date to PayPal.
      payment_date: deps.now().toISOString().slice(0, 10),
      amount: { currency_code: invoice.currency, value: centsToValue(dueCents) },
      note: "Sandbox demo payment recorded in PaidPath",
    });
    const paypal = (await deps.callTool("get_invoice", {
      invoice_id: invoice.paypalInvoiceId,
    })) as PayPalInvoice;
    const { invoice: updated } = applyPayPalState(db, invoice.id, paypal, now);
    logAgentRun(db, {
      projectId,
      actor: deps.actor ?? "user",
      action: "record_payment",
      payload: { invoiceId },
      result: {
        status: updated.paypalStatus,
        paidCents: updated.paidAmountCents,
        discountTaken: updated.paidAmountCents !== null && updated.paidAmountCents < updated.amountCents,
      },
      durationMs: Date.now() - started,
      ok: true,
    });
    return updated;
  } catch (error) {
    friendly(error);
  }
}

export type InvoiceView = Omit<Invoice, "qrPng"> & { hasQr: boolean; overdue: boolean };

export function listProjectInvoices(db: Db, projectId: number, now = new Date()): InvoiceView[] {
  const project = getProject(db, projectId);
  const today = project ? projectToday(project, now) : toIsoDate(now.toISOString());
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.projectId, projectId))
    .orderBy(desc(invoices.id))
    .all()
    .map(({ qrPng, ...rest }) => ({
      ...rest,
      hasQr: Boolean(qrPng),
      overdue: rest.status === "sent" && Boolean(rest.dueAt) && toIsoDate(rest.dueAt!) < today,
    }));
}

export function getInvoiceQr(db: Db, projectId: number, invoiceId: number) {
  return getOwnedInvoice(db, projectId, invoiceId).qrPng;
}

/** Milestone fields the Gantt mirrors from invoices. */
export function milestoneStatuses(db: Db, projectId: number) {
  return db
    .select({ taskId: tasks.id, invoiceStatus: tasks.invoiceStatus, percentDone: tasks.percentDone })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.amountCents)))
    .all();
}
