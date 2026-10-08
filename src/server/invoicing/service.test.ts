import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { agentLog, invoices, projects, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import {
  invoiceMilestone,
  InvoicingError,
  milestoneStatuses,
  recordDemoPayment,
  refreshProjectInvoices,
  remindInvoice,
  type InvoicingDeps,
} from "./service";

/** In-memory fake of the PayPal toolkit tools the service uses. */
function fakePayPal() {
  const store = new Map<string, { status: string }>();
  const calls: string[] = [];
  let failNext: string | null = null;
  let counter = 0;
  const callTool: InvoicingDeps["callTool"] = async (name, args) => {
    calls.push(name);
    if (failNext === name) {
      failNext = null;
      throw new Error(`${name} exploded`);
    }
    const id = String(args.invoice_id ?? "");
    switch (name) {
      case "create_invoice": {
        const newId = `INV2-FAKE-${++counter}`;
        store.set(newId, { status: "DRAFT" });
        return { href: `https://api.sandbox.paypal.com/v2/invoicing/invoices/${newId}` };
      }
      case "send_invoice":
        store.get(id)!.status = "SENT";
        return { href: "payer-view" };
      case "get_invoice":
        return {
          id,
          status: store.get(id)!.status,
          detail: {
            invoice_number: `000${counter}`,
            metadata: { recipient_view_url: `https://pay/${id}`, invoicer_view_url: `https://admin/${id}` },
          },
        };
      case "generate_invoice_qr_code":
        return "--b\r\n\r\niVBORw0KGgoFAKE\r\n--b--";
      case "send_invoice_reminder":
        return "";
      case "record_payment_for_invoice":
        store.get(id)!.status = "MARKED_AS_PAID";
        return { payment_id: "EXTR-1" };
      default:
        throw new Error(`unexpected tool ${name}`);
    }
  };
  return {
    store,
    calls,
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

  test("invoices of another project are not reachable", async () => {
    const invoice = await invoiceMilestone(db, projectId, milestoneId, paypal.deps);
    const other = seedDemoProject(db);
    await assert.rejects(remindInvoice(db, other, invoice.id, paypal.deps), (e: InvoicingError) => e.status === 404);
  });
});
