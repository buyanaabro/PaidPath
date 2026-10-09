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
 * Seeds the shared demo project only when the database has no projects yet — in development
 * by default. In production visitors get their own demo copies instead (opt back in with
 * `SEED_DEMO_ON_START=true`; `false` disables it in development).
 */
export function seedIfEmpty(db: Db) {
  const flag = process.env.SEED_DEMO_ON_START;
  if (flag === "false" || (process.env.NODE_ENV === "production" && flag !== "true")) return;
  const existing = db.select({ id: projects.id }).from(projects).limit(1).get();
  if (!existing) seedDemoProject(db);
}

export function resetAndSeed(db: Db) {
  db.delete(projects).run();
  return seedDemoProject(db);
}
