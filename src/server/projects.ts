import { desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentLog, projects, tasks, type AgentActor } from "@/db/schema";
import { materializePlan } from "@/server/architect/materialize";
import type { NormalizedPlan } from "@/server/architect/schema";
import { insertPlanTree } from "@/server/plan-tree";

export type NewProjectInput = {
  name?: string;
  ownerToken?: string | null;
  clientName: string;
  clientEmail: string;
  budgetCents: number;
  currency: string;
  startDate: string;
  paymentTermsDays?: number;
  briefText: string;
};

export function createDraftProject(db: Db, input: NewProjectInput, plan: NormalizedPlan) {
  return db.transaction((tx) => {
    const { id } = tx
      .insert(projects)
      .values({ ...input, name: input.name || plan.projectName, status: "draft" })
      .returning({ id: projects.id })
      .get();
    insertPlanTree(tx, id, materializePlan({ ...plan, projectName: input.name || plan.projectName }));
    return id;
  });
}

/** Replaces a project's tasks and dependencies (FK cascade) with a new plan. */
export function replaceProjectPlan(db: Db, projectId: number, plan: NormalizedPlan) {
  db.transaction((tx) => {
    const project = tx.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) throw new Error(`Project ${projectId} not found`);
    tx.delete(tasks).where(eq(tasks.projectId, projectId)).run();
    insertPlanTree(tx, projectId, materializePlan({ ...plan, projectName: project.name }));
    tx.update(projects).set({ status: "draft" }).where(eq(projects.id, projectId)).run();
  });
}

export function acceptProjectPlan(db: Db, projectId: number) {
  db.update(projects).set({ status: "active" }).where(eq(projects.id, projectId)).run();
}

export function getProject(db: Db, projectId: number) {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

/** Rebuilds the architect's view of an existing plan (for revision prompts). */
export function currentPlanOutline(db: Db, projectId: number): NormalizedPlan | undefined {
  const rows = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
  const root = rows.find((t) => t.parentId === null);
  if (!root) return undefined;
  const childrenOf = (id: number) =>
    rows.filter((t) => t.parentId === id).sort((a, b) => a.orderIndex - b.orderIndex);
  return {
    projectName: root.name,
    phases: childrenOf(root.id).map((phase) => {
      const children = childrenOf(phase.id);
      const milestone = children.find((t) => t.duration === 0 && t.amountCents !== null);
      return {
        name: phase.name,
        tasks: children
          .filter((t) => t !== milestone)
          .map((t) => ({ key: String(t.id), name: t.name, durationDays: t.duration ?? 1, dependsOn: [] })),
        milestone: {
          name: milestone?.name.replace(/^Milestone:\s*/, "") ?? `${phase.name} delivered`,
          amountCents: milestone?.amountCents ?? 0,
        },
      };
    }),
  };
}

/** Projects the visitor created (cookie) plus shared ones without an owner. */
export function listProjects(db: Db, ownerToken: string | null = null) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      clientName: projects.clientName,
      status: projects.status,
      startDate: projects.startDate,
      createdAt: projects.createdAt,
      isDemo: projects.isDemo,
      totalCents: sql<number>`coalesce(sum(${tasks.amountCents}), 0)`,
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(ownerToken ? or(isNull(projects.ownerToken), eq(projects.ownerToken, ownerToken)) : isNull(projects.ownerToken))
    .groupBy(projects.id)
    .orderBy(desc(projects.id))
    .all();
}

export function logAgentRun(
  db: Db,
  entry: {
    projectId?: number | null;
    actor: AgentActor;
    action: string;
    payload?: unknown;
    result?: unknown;
    durationMs: number;
    ok: boolean;
  },
) {
  // Audit logging must never break the user-facing action it describes.
  try {
    db.insert(agentLog)
      .values({
        projectId: entry.projectId ?? null,
        actor: entry.actor,
        action: entry.action,
        payloadJson: entry.payload === undefined ? null : JSON.stringify(entry.payload),
        resultJson: entry.result === undefined ? null : JSON.stringify(entry.result),
        durationMs: entry.durationMs,
        ok: entry.ok,
      })
      .run();
  } catch (error) {
    console.error("Failed to write agent log", error);
  }
}
