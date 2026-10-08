import assert from "node:assert/strict";
import { test } from "node:test";
import { createDb } from "@/db/client";
import { projects } from "@/db/schema";
import { loadProject } from "@/server/gantt/crud";
import { seedDemoProject } from "@/db/seed";
import { insertPlanTree, type PlanNode } from "@/server/plan-tree";
import { createDraftProject, listProjects } from "@/server/projects";
import { materializePlan } from "./materialize";
import type { NormalizedPlan } from "./schema";

const plan: NormalizedPlan = {
  projectName: "Mobile MVP",
  phases: [
    {
      name: "Discovery",
      tasks: [
        { key: "a", name: "Interviews", durationDays: 2, dependsOn: [] },
        { key: "b", name: "Scope", durationDays: 3, dependsOn: ["a"] },
      ],
      milestone: { name: "Scope signed", amountCents: 200_000 },
    },
    {
      name: "Build",
      tasks: [
        { key: "a", name: "API", durationDays: 5, dependsOn: [] },
        { key: "b", name: "App", durationDays: 5, dependsOn: [] },
        { key: "c", name: "QA", durationDays: 2, dependsOn: ["a", "b"] },
      ],
      milestone: { name: "App shipped", amountCents: 500_000 },
    },
  ],
};

test("builds root → phases → tasks + milestone with gates on all but the last", () => {
  const tree = materializePlan(plan);
  const [root] = tree.nodes;
  assert.equal(root.name, "Mobile MVP");
  const [discovery, build] = root.children!;
  const milestone = (p: PlanNode) => p.children!.at(-1)!;
  assert.equal(milestone(discovery).name, "Milestone: Scope signed");
  assert.equal(milestone(discovery).duration, 0);
  assert.equal(milestone(discovery).amountCents, 200_000);
  assert.equal(milestone(discovery).paymentGate, true);
  assert.equal(milestone(build).paymentGate, false);
});

test("links phases through milestones", () => {
  const { links } = materializePlan(plan);
  const has = (from: string, to: string) => links.some((l) => l.from === from && l.to === to);
  assert.ok(has("p0:a", "p0:b"));
  assert.ok(has("p0:b", "p0:milestone"));
  assert.ok(!has("p0:a", "p0:milestone"), "a has an in-phase successor");
  assert.ok(has("p0:milestone", "p1:a"));
  assert.ok(has("p0:milestone", "p1:b"));
  assert.ok(!has("p0:milestone", "p1:c"), "c already waits on a and b");
  assert.ok(has("p1:c", "p1:milestone"));
  // Discovery: a→b, b→m0. Build: m0→a, m0→b, a→c, b→c, c→m1.
  assert.equal(links.length, 7);
});

test("project list totals sum each project's milestone amounts", () => {
  const db = createDb(":memory:");
  const draftId = createDraftProject(
    db,
    { clientName: "C", clientEmail: "c@example.com", budgetCents: 700_000, currency: "USD", startDate: "2026-11-02", briefText: "b" },
    plan,
  );
  seedDemoProject(db);
  const rows = listProjects(db);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === draftId)?.totalCents, 700_000);
  assert.equal(rows.find((r) => r.id !== draftId)?.totalCents, 700_000);
  assert.equal(rows.find((r) => r.id === draftId)?.status, "draft");
});

test("the materialized tree persists and loads through the Gantt protocol", () => {
  const db = createDb(":memory:");
  const { id } = db
    .insert(projects)
    .values({ name: "Mobile MVP", clientName: "C", clientEmail: "c@example.com", budgetCents: 700_000, startDate: "2026-11-02" })
    .returning({ id: projects.id })
    .get();
  insertPlanTree(db, id, materializePlan(plan));
  const loaded = loadProject(db, id)!;
  assert.equal(loaded.dependencies.rows.length, 7);
  const phases = loaded.tasks.rows[0].children as { children: { amount?: number }[] }[];
  assert.deepEqual(phases.map((p) => p.children.at(-1)!.amount), [2000, 5000]);
});
