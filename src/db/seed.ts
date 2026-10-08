import { insertPlanTree } from "@/server/plan-tree";
import type { Db } from "./client";
import { demoPlan, demoProject } from "./demo-project";
import { projects } from "./schema";

export function seedDemoProject(db: Db) {
  return db.transaction((tx) => {
    const { id } = tx
      .insert(projects)
      .values({
        ...demoProject,
        clientEmail: process.env.PAYPAL_SANDBOX_BUYER_EMAIL || "client@example.com",
        status: "active",
      })
      .returning({ id: projects.id })
      .get();
    insertPlanTree(tx, id, demoPlan);
    return id;
  });
}

/** Seeds the demo project only when the database has no projects yet. */
export function seedIfEmpty(db: Db) {
  const existing = db.select({ id: projects.id }).from(projects).limit(1).get();
  if (!existing) seedDemoProject(db);
}

export function resetAndSeed(db: Db) {
  db.delete(projects).run();
  return seedDemoProject(db);
}
