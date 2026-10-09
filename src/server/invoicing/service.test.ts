import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { agentLog, invoices, projects, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import {
  expireDiscounts,
  invoiceMilestone,
  listProjectInvoices,
  InvoicingError,
  milestoneStatuses,
  recordDemoPayment,
  refreshProjectInvoices,
  remindInvoice,
  type InvoicingDeps,
} from "./service";

/** In-memory fake of the PayPal toolkit tools the service uses. */
function fakePayPal() {
  const store = new Map<string, { status: string; amount: number; discount: number; paid?: number }>();
  const calls: string[] = [];
  const lastArgs: Record<string, Record<string, unknown>> = {};
  let failNext: string | null = null;
  let counter = 0;
  const callTool: InvoicingDeps["callTool"] = async (name, args) => {
    calls.push(name);
    lastArgs[name] = args;
    if (failNext === name) {
      failNext = null;
      throw new Error(`${name} exploded`);
    }
    const id = String(args.invoice_id ?? "");
    switch (name) {
      case "create_invoice": {
        const newId = `INV2-FAKE-${++counter}`;
        const item = (args.items as { unit_amount: { value: string }; discount?: { percent: string } }[])[0];
        store.set(newId, { status: "DRAFT", amount: Number(item.unit_amount.value), discount: Number(item.discount?.percent ?? 0) });
        return { href: `https://api.sandbox.paypal.com/v2/invoicing/invoices/${newId}` };
      }
      case "send_invoice":
        store.get(id)!.status = "SENT";
        return { href: "payer-view" };
      case "get_invoice": {
        const inv = store.get(id)!;
        const total = inv.amount * (1 - inv.discount / 100);
        return {
          id,
          status: inv.status,
          detail: {
            invoice_number: `000${counter}`,
            invoice_date: "2026-11-20",
            metadata: { recipient_view_url: `https://pay/${id}`, invoicer_view_url: `https://admin/${id}` },
          },
          due_amount: { currency_code: "USD", value: (inv.paid === undefined ? total : 0).toFixed(2) },
          ...(inv.paid === undefined ? {} : { payments: { paid_amount: { currency_code: "USD", value: inv.paid.toFixed(2) } } }),
        };
      }
      case "update_invoicing": {
        const update = args.invoice_update as { invoice_id: string; items: { discount?: { percent: string } }[] };
        store.get(update.invoice_id)!.discount = Number(update.items[0].discount?.percent ?? 0);
        return { id: update.invoice_id, status: store.get(update.invoice_id)!.status };
      }
      case "generate_invoice_qr_code":
        return "--b\r\n\r\niVBORw0KGgoFAKE\r\n--b--";
      case "send_invoice_reminder":
        return "";
      case "record_payment_for_invoice":
        store.get(id)!.status = "MARKED_AS_PAID";
        store.get(id)!.paid = Number((args.amount as { value: string }).value);
        return { payment_id: "EXTR-1" };
      default:
        throw new Error(`unexpected tool ${name}`);
    }
  };
  return {
    store,
    calls,
    lastArgs,
    failOn: (name: string) => (failNext = name),
    deps: {
      callTool,
      draftNote: async () => ({ note: "AI note: thanks for approving the designs.", source: "ai" as const }),
      now: () => new Date("2026-11-20T10:00:00Z"),
    } satisfies InvoicingDeps,
  };
}

let db: Db;
let projectId: number;
let milestoneId: number;
let paypal: ReturnType<typeof fakePayPal>;

beforeEach(() => {
  db = createDb(":memory:");
  projectId = seedDemoProject(db);
  milestoneId = db.select().from(tasks).where(eq(tasks.name, "Milestone: Designs signed off")).get()!.id;
  paypal = fakePayPal();
});

const task = (id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get()!;

describe("invoiceMilestone", () => {
  test("creates, sends and records the invoice and mirrors it onto the milestone", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    assert.deepEqual(paypal.calls, ["create_invoice", "send_invoice", "get_invoice", "generate_invoice_qr_code"]);
    assert.equal(invoice.status, "sent");
    assert.equal(invoice.amountCents, 250_000);
    assert.equal(invoice.payUrl, `https://pay/${invoice.paypalInvoiceId}`);
    assert.equal(invoice.noteSource, "ai");
    assert.equal(invoice.dueAt, "2026-12-04T10:00:00.000Z");
    assert.equal(db.select().from(invoices).get()!.qrPng, "iVBORw0KGgoFAKE");
    assert.equal(task(milestoneId).invoiceStatus, "sent");
    assert.equal(task(milestoneId).percentDone, 100);
    const log = db.select().from(agentLog).all().at(-1)!;
    assert.equal(log.action, "invoice_milestone");
    assert.equal(log.ok, true);
  });

  test("rejects draft projects, non-milestones and double invoicing", async () => {
    db.update(projects).set({ status: "draft" }).where(eq(projects.id, projectId)).run();
    await assert.rejects(invoiceMilestone(db, projectId, milestoneId, paypal.deps), (e: InvoicingError) => e.status === 409);
    db.update(projects).set({ status: "active" }).where(eq(projects.id, projectId)).run();

    const wireframes = db.select().from(tasks).where(eq(tasks.name, "Wireframes")).get()!.id;
    await assert.rejects(invoiceMilestone(db, projectId, wireframes, paypal.deps), (e: InvoicingError) => e.status === 400);

    await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    await assert.rejects(invoiceMilestone(db, projectId, milestoneId, paypal.deps), (e: InvoicingError) => e.status === 409);
    assert.equal(paypal.calls.filter((c) => c === "create_invoice").length, 1);
  });

  test("a failed send keeps the draft and a retry sends it without creating a duplicate", async () => {
    paypal.failOn("send_invoice");
    await assert.rejects(invoiceMilestone(db, projectId, milestoneId, paypal.deps), (e: InvoicingError) => e.status === 502);
    assert.equal(db.select().from(invoices).get()!.status, "draft");
    assert.equal(task(milestoneId).invoiceStatus, "none");

    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    assert.equal(invoice.status, "sent");
    assert.equal(paypal.calls.filter((c) => c === "create_invoice").length, 1);
    assert.equal(db.select().from(invoices).all().length, 1);
  });

  test("still invoices when the note comes from the template fallback", async () => {
    const deps = { ...paypal.deps, draftNote: async () => ({ note: "Template note", source: "template" as const }) };
    const invoice = await invoiceMilestone(db, projectId, milestoneId, deps);
    assert.equal(invoice.noteSource, "template");
    assert.equal(invoice.status, "sent");
  });
});

describe("project clock and payment terms", () => {
  const setProject = (values: Partial<typeof projects.$inferInsert>) =>
    db.update(projects).set(values).where(eq(projects.id, projectId)).run();

  test("sent/due dates follow the demo clock and the project's terms", async () => {
    setProject({ demoToday: "2026-11-06", paymentTermsDays: 7 });
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    assert.equal(invoice.sentAt, "2026-11-06T12:00:00.000Z");
    assert.equal(invoice.dueAt, "2026-11-13T12:00:00.000Z");
  });

  test("overdue is judged against the project's today", async () => {
    setProject({ demoToday: "2026-11-06" });
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    const view = () => listProjectInvoices(db, projectId).find((i) => i.id === invoice.id)!;
    assert.equal(view().overdue, false);
    setProject({ demoToday: "2026-11-20" }); // due date itself: not overdue yet
    assert.equal(view().overdue, false);
    setProject({ demoToday: "2026-11-21" });
    assert.equal(view().overdue, true);
  });

  test("payments are dated on the project clock, but PayPal gets the real date", async () => {
    setProject({ demoToday: "2026-11-08" });
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    const calls: Record<string, unknown>[] = [];
    const deps = {
      ...paypal.deps,
      callTool: async (name: string, args: Record<string, unknown>) => {
        if (name === "record_payment_for_invoice") calls.push(args);
        return paypal.deps.callTool(name, args);
      },
    };
    const paid = await recordDemoPayment(db, projectId, invoice.id, deps);
    assert.equal(paid.paidAt, "2026-11-08T12:00:00.000Z");
    assert.equal(calls[0].payment_date, "2026-11-20"); // fake "real" now from deps.now()
  });
});

describe("payments and reminders", () => {
  test("refresh picks up a payment made on PayPal", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    assert.equal(await refreshProjectInvoices(db, projectId, paypal.deps), 0);
    paypal.store.get(invoice.paypalInvoiceId)!.status = "PAID";
    assert.equal(await refreshProjectInvoices(db, projectId, paypal.deps), 1);
    const updated = db.select().from(invoices).get()!;
    assert.equal(updated.status, "paid");
    assert.equal(updated.paidAt, "2026-11-20T10:00:00.000Z");
    assert.equal(task(milestoneId).invoiceStatus, "paid");
    assert.deepEqual(
      milestoneStatuses(db, projectId).find((m) => m.taskId === milestoneId),
      { taskId: milestoneId, invoiceStatus: "paid", percentDone: 100 },
    );
  });

  test("recording a demo payment marks the invoice paid", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    const paid = await recordDemoPayment(db, projectId, invoice.id, paypal.deps);
    assert.equal(paid.status, "paid");
    assert.equal(paid.paypalStatus, "MARKED_AS_PAID");
    await assert.rejects(recordDemoPayment(db, projectId, invoice.id, paypal.deps), (e: InvoicingError) => e.status === 409);
  });

  test("reminders count up and are only allowed while unpaid", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    await remindInvoice(db, projectId, invoice.id, paypal.deps);
    const reminded = await remindInvoice(db, projectId, invoice.id, paypal.deps);
    assert.equal(reminded.reminderCount, 2);
    await recordDemoPayment(db, projectId, invoice.id, paypal.deps);
    await assert.rejects(remindInvoice(db, projectId, invoice.id, paypal.deps), (e: InvoicingError) => e.status === 409);
  });

  test("reminder tone escalates, a copilot note wins, and the actor is attributed", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    await remindInvoice(db, projectId, invoice.id, paypal.deps);
    assert.match(String(paypal.lastArgs.send_invoice_reminder.subject), /^Reminder: Designs signed off/);
    assert.match(String(paypal.lastArgs.send_invoice_reminder.note), /friendly reminder/);
    await remindInvoice(db, projectId, invoice.id, paypal.deps);
    assert.match(String(paypal.lastArgs.send_invoice_reminder.subject), /^Payment overdue:/);
    await remindInvoice(db, projectId, invoice.id, { ...paypal.deps, actor: "copilot" }, { note: "  Hi Aurora — any update?  " });
    assert.match(String(paypal.lastArgs.send_invoice_reminder.subject), /^Final notice:/);
    assert.equal(paypal.lastArgs.send_invoice_reminder.note, "Hi Aurora — any update?");
    const log = db.select().from(agentLog).all().at(-1)!;
    assert.equal(log.actor, "copilot");
    assert.equal(JSON.parse(log.payloadJson!).noteSource, "copilot");
    assert.equal(db.select().from(agentLog).where(eq(agentLog.action, "invoice_milestone")).get()!.actor, "user");
  });

  test("invoices of another project are not reachable", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    const other = seedDemoProject(db);
    await assert.rejects(remindInvoice(db, other, invoice.id, paypal.deps), (e: InvoicingError) => e.status === 404);
  });
});

describe("early-payment discounts", () => {
  const sendWithDiscount = () =>
    invoiceMilestone(db, projectId, milestoneId, { ...paypal.deps, baseUrl: "https://paidpath.test" }, { discount: { percent: 2, days: 7 } });

  test("sends a line-item discount, tracks the window and puts terms + portal link in the note", async () => {
    const invoice = await sendWithDiscount();
    const item = (paypal.lastArgs.create_invoice.items as { discount?: { percent: string } }[])[0];
    assert.deepEqual(item.discount, { percent: "2" });
    assert.equal(invoice.discountPercent, 2);
    assert.equal(invoice.discountUntil, "2026-11-27");
    assert.match(invoice.note!, /Early-payment discount: 2% \(\$50\) is already taken off if you pay by Nov 27, 2026\./);
    assert.match(invoice.note!, /Follow your project's timeline: https:\/\/paidpath\.test\/p\/[A-Za-z0-9_-]{32}/);
    const log = db.select().from(agentLog).where(eq(agentLog.action, "invoice_milestone")).get()!;
    assert.deepEqual(JSON.parse(log.payloadJson!).discount, { percent: 2, until: "2026-11-27" });
  });

  test("paying inside the window pays the discounted amount", async () => {
    const invoice = await sendWithDiscount();
    const paid = await recordDemoPayment(db, projectId, invoice.id, paypal.deps);
    assert.equal(paypal.lastArgs.record_payment_for_invoice.amount && (paypal.lastArgs.record_payment_for_invoice.amount as { value: string }).value, "2450.00");
    assert.equal(paid!.status, "paid");
    assert.equal(paid!.paidAmountCents, 245_000);
  });

  test("expires the discount on PayPal once the project's today passes the deadline", async () => {
    const invoice = await sendWithDiscount();
    assert.equal(await expireDiscounts(db, projectId, paypal.deps), 0);
    db.update(projects).set({ demoToday: "2026-11-28" }).where(eq(projects.id, projectId)).run();
    assert.equal(await expireDiscounts(db, projectId, paypal.deps), 1);
    const update = paypal.lastArgs.update_invoicing as { invoice_update: { invoice_id: string; note: string; invoice_date: string; items: { discount?: unknown }[]; send_to_recipient: boolean } };
    assert.equal(update.invoice_update.invoice_id, invoice.paypalInvoiceId);
    assert.equal(update.invoice_update.items[0].discount, undefined);
    assert.equal(update.invoice_update.invoice_date, "2026-11-20");
    assert.equal(update.invoice_update.send_to_recipient, true);
    assert.doesNotMatch(update.invoice_update.note, /Early-payment discount:/);
    assert.match(update.invoice_update.note, /The early-payment discount offer ended on Nov 27, 2026\./);
    assert.match(update.invoice_update.note, /Follow your project's timeline/);
    const stored = db.select().from(invoices).where(eq(invoices.id, invoice.id)).get()!;
    assert.ok(stored.discountExpiredAt);
    // Idempotent; a later payment pays the full amount.
    assert.equal(await expireDiscounts(db, projectId, paypal.deps), 0);
    const paid = await recordDemoPayment(db, projectId, invoice.id, paypal.deps);
    assert.equal(paid!.paidAmountCents, 250_000);
  });

  test("does not touch an invoice that PayPal already reports as paid", async () => {
    const invoice = await sendWithDiscount();
    paypal.store.get(invoice.paypalInvoiceId)!.status = "PAID";
    paypal.store.get(invoice.paypalInvoiceId)!.paid = 2450;
    db.update(projects).set({ demoToday: "2026-12-30" }).where(eq(projects.id, projectId)).run();
    assert.equal(await expireDiscounts(db, projectId, paypal.deps), 0);
    assert.equal(paypal.calls.includes("update_invoicing"), false);
    assert.equal(db.select().from(invoices).where(eq(invoices.id, invoice.id)).get()!.status, "paid");
  });
});
