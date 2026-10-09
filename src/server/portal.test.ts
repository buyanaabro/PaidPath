import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { agentLog, invoices, projects, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { ensureShareToken, projectByToken, recordPortalVisit, rotateShareToken } from "./portal";
import { portalSnapshot } from "./portal-snapshot";

let db: Db;
let projectId: number;

beforeEach(() => {
  db = createDb(":memory:");
  projectId = seedDemoProject(db);
});

describe("client portal tokens", () => {
  test("creates one stable token, resolves it, and rotation revokes the old link", () => {
    const token = ensureShareToken(db, projectId)!;
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(ensureShareToken(db, projectId), token);
    assert.equal(projectByToken(db, token)!.id, projectId);
    const rotated = rotateShareToken(db, projectId);
    assert.notEqual(rotated, token);
    assert.equal(projectByToken(db, token), undefined);
    assert.equal(projectByToken(db, rotated)!.id, projectId);
  });

  test("rejects malformed tokens without a lookup and unknown projects", () => {
    assert.equal(projectByToken(db, "../etc"), undefined);
    assert.equal(projectByToken(db, ""), undefined);
    assert.equal(ensureShareToken(db, 999), null);
  });

  test("logs a client visit at most once per hour", () => {
    assert.equal(recordPortalVisit(db, projectId), true);
    assert.equal(recordPortalVisit(db, projectId), false);
    assert.equal(recordPortalVisit(db, projectId, new Date(Date.now() + 61 * 60_000)), true);
    const visits = db.select().from(agentLog).where(eq(agentLog.action, "portal_viewed")).all();
    assert.equal(visits.length, 2);
    assert.equal(visits[0].actor, "client");
  });
});

describe("portal snapshot", () => {
  test("shows the client's invoices with discount state but no owner-only data", () => {
    const milestone = db.select().from(tasks).where(eq(tasks.name, "Milestone: Designs signed off")).get()!;
    db.insert(invoices)
      .values({
        projectId,
        taskId: milestone.id,
        paypalInvoiceId: "INV2-SECRET",
        invoiceNumber: "0042",
        milestoneName: milestone.name,
        amountCents: 250_000,
        paypalStatus: "SENT",
        status: "sent",
        note: "internal draft note",
        noteSource: "ai",
        payUrl: "https://pay.example/INV2-SECRET",
        invoicerUrl: "https://merchant.example/admin",
        sentAt: "2026-11-16T12:00:00.000Z",
        dueAt: "2026-11-30T12:00:00.000Z",
        discountPercent: 2,
        discountDays: 7,
        discountUntil: "2026-11-23",
      })
      .run();
    db.update(projects).set({ demoToday: "2026-11-20" }).where(eq(projects.id, projectId)).run();
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    const snapshot = portalSnapshot(db, project);
    const json = JSON.stringify(snapshot);
    for (const secret of ["merchant.example", "invoicerUrl", "internal draft note", "noteSource", "clientEmail", project.clientEmail]) {
      assert.equal(json.includes(secret), false, `leaks ${secret}`);
    }
    assert.equal(snapshot.project.today, "2026-11-20");
    assert.equal(snapshot.invoices[0].milestone, "Designs signed off");
    assert.equal(snapshot.invoices[0].payUrl, "https://pay.example/INV2-SECRET");
    assert.equal(snapshot.invoices[0].discount!.state, "active");
    assert.equal(snapshot.invoices[0].discount!.discountedCents, 245_000);
  });
});
