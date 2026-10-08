import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { dependencies, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { loadProject, syncProject } from "./crud";
import type { WireRow } from "./protocol";

let db: Db;
let projectId: number;

const flatten = (rows: WireRow[]): WireRow[] =>
  rows.flatMap((row) => [row, ...flatten((row.children as WireRow[]) ?? [])]);

const taskByName = (name: string) => {
  const task = db.select().from(tasks).where(eq(tasks.name, name)).get();
  assert.ok(task, `task ${name} exists`);
  return task;
};

beforeEach(() => {
  db = createDb(":memory:");
  projectId = seedDemoProject(db);
});

describe("loadProject", () => {
  test("returns the seeded plan as an ordered tree with dollar amounts", () => {
    const response = loadProject(db, projectId);
    assert.ok(response);
    const [root] = response.tasks.rows;
    assert.equal(root.name, "Aurora Coffee — brand site");
    const phases = root.children as WireRow[];
    assert.deepEqual(
      phases.map((p) => p.name),
      ["Discovery & brand direction", "Design", "Build & launch"],
    );
    assert.equal(flatten(response.tasks.rows).length, 14);
    const milestone = (phases[1].children as WireRow[])[2];
    assert.equal(milestone.amount, 2500);
    assert.equal(milestone.invoiceStatus, "sent");
    assert.equal(response.dependencies.rows.length, 9);
    assert.equal(response.project.startDate, "2026-11-02");
  });

  test("returns null for an unknown project", () => {
    assert.equal(loadProject(db, 9999), null);
  });
});

describe("syncProject", () => {
  test("adds a task under an existing parent and maps its phantom id", () => {
    const design = taskByName("Design");
    const response = syncProject(db, projectId, {
      requestId: 1,
      tasks: {
        added: [{ $PhantomId: "_g1", name: "Logo exploration", parentId: design.id, parentIndex: 1, duration: 2 }],
      },
    });
    const [row] = response.tasks!.rows!;
    assert.equal(row.$PhantomId, "_g1");
    const created = taskByName("Logo exploration");
    assert.equal(row.id, created.id);
    assert.equal(created.parentId, design.id);
    assert.equal(created.orderIndex, 1);
    assert.equal(response.requestId, 1);
  });

  test("resolves phantom parents and phantom dependency endpoints in one request", () => {
    const root = taskByName("Aurora Coffee — brand site");
    const response = syncProject(db, projectId, {
      tasks: {
        // Child listed before its parent on purpose.
        added: [
          { $PhantomId: "_child", name: "Ad mockups", parentId: "_parent", duration: 3 },
          { $PhantomId: "_parent", name: "Ad campaign", parentId: root.id, parentIndex: 3 },
        ],
      },
      dependencies: {
        added: [{ $PhantomId: "_dep", fromEvent: taskByName("QA & launch").id, toEvent: "_child" }],
      },
    });
    const parent = taskByName("Ad campaign");
    const child = taskByName("Ad mockups");
    assert.equal(child.parentId, parent.id);
    const [dep] = response.dependencies!.rows!;
    assert.equal(dep.$PhantomId, "_dep");
    const stored = db.select().from(dependencies).where(eq(dependencies.id, dep.id as number)).get();
    assert.equal(stored?.toTaskId, child.id);
  });

  test("updates whitelisted fields and ignores unknown engine fields", () => {
    const mockups = taskByName("High-fidelity mockups");
    const milestone = taskByName("Milestone: Site live");
    const response = syncProject(db, projectId, {
      tasks: {
        updated: [
          { id: mockups.id, name: "Hi-fi mockups", startDate: "2026-11-10T00:00:00", duration: 7, effort: 56, calendar: 3 },
          { id: milestone.id, amount: 3250.5 },
        ],
      },
    });
    assert.deepEqual(response.tasks!.rows, [{ id: mockups.id }, { id: milestone.id }]);
    const updated = taskByName("Hi-fi mockups");
    assert.equal(updated.startDate, "2026-11-10T00:00:00");
    assert.equal(updated.duration, 7);
    assert.equal(taskByName("Milestone: Site live").amountCents, 325_050);
  });

  test("removing a parent cascades its children and their dependencies", () => {
    const design = taskByName("Design");
    const response = syncProject(db, projectId, { tasks: { removed: [{ id: design.id }] } });
    assert.deepEqual(response.tasks!.removed, [{ id: design.id }]);
    const remaining = flatten(loadProject(db, projectId)!.tasks.rows).map((t) => t.name);
    assert.ok(!remaining.includes("Wireframes"));
    assert.equal(remaining.length, 10);
    // m1→wireframes, wireframes→mockups, mockups→m2, m2→frontend are gone.
    assert.equal(db.select().from(dependencies).all().length, 5);
  });

  test("ignores ids that belong to another project", () => {
    const otherProjectId = seedDemoProject(db);
    const foreign = db.select().from(tasks).where(eq(tasks.projectId, otherProjectId)).all()[1];
    const response = syncProject(db, projectId, {
      tasks: { updated: [{ id: foreign.id, name: "hijacked" }], removed: [{ id: foreign.id }] },
    });
    assert.equal(response.tasks, undefined);
    const untouched = db.select().from(tasks).where(eq(tasks.id, foreign.id)).get();
    assert.equal(untouched?.name, foreign.name);
  });

  test("responds with the shape Bryntum validates", () => {
    const wireframes = taskByName("Wireframes");
    const dep = db.select().from(dependencies).all()[0];
    const response = syncProject(db, projectId, {
      requestId: 42,
      tasks: { added: [{ $PhantomId: "_n", name: "New" }], updated: [{ id: wireframes.id, percentDone: 50 }] },
      dependencies: { removed: [{ id: dep.id }] },
    });
    assert.equal(response.success, true);
    assert.equal(response.requestId, 42);
    assert.equal(response.tasks!.rows!.length, 2);
    assert.ok(response.tasks!.rows!.every((r) => typeof r.id === "number"));
    assert.deepEqual(response.dependencies!.removed, [{ id: dep.id }]);
  });
});
