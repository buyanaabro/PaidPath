import { insertPlanTree } from "@/server/plan-tree";
import type { Db } from "./client";
import { demoPlan, demoProject } from "./demo-project";
import { projects } from "./schema";

export type DemoSeedOptions = {
  ownerToken?: string | null;
  isDemo?: boolean;
  /** Demo clock to start on (YYYY-MM-DD). */
  demoToday?: string | null;
};

export function seedDemoProject(db: Db, options: DemoSeedOptions = {}) {
  return db.transaction((tx) => {
    const { id } = tx
      .insert(projects)
      .values({
        ...demoProject,
        clientEmail: process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "client@example.com",
        status: "active",
        ownerToken: options.ownerToken ?? null,
        isDemo: options.isDemo ?? false,
        demoToday: options.demoToday ?? null,
      })
      .returning({ id: projects.id })
      .get();
    insertPlanTree(tx, id, demoPlan);
    return id;
  });
}

/**
 * Seeds the shared demo project only when the database has no projects yet. The hosted demo
 * disables this (`SEED_DEMO_ON_START=false`): visitors get their own copies instead.
 */
export function seedIfEmpty(db: Db) {
  if (process.env.SEED_DEMO_ON_START === "false") return;
  const existing = db.select({ id: projects.id }).from(projects).limit(1).get();
  if (!existing) seedDemoProject(db);
}

export function resetAndSeed(db: Db) {
  db.delete(projects).run();
  return seedDemoProject(db);
}
