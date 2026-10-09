import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { DEMO_STORY_TODAY } from "@/db/demo-project";
import { projects } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { logAgentRun } from "@/server/projects";

export const VISITOR_COOKIE = "pp_visitor";
export const VISITOR_MAX_AGE_S = 30 * 24 * 60 * 60;
export const DEMO_MAX_AGE_MS = 24 * 60 * 60_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const newVisitorToken = () => randomBytes(24).toString("base64url");
export const validVisitorToken = (value: string | undefined | null): value is string =>
  Boolean(value && TOKEN_PATTERN.test(value));

/** Deletes demo copies older than 24 h (tasks/invoices cascade; agent log rows keep a null project). */
export function cleanupDemoCopies(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - DEMO_MAX_AGE_MS).toISOString();
  return db
    .delete(projects)
    .where(and(eq(projects.isDemo, true), lt(projects.createdAt, cutoff)))
    .returning({ id: projects.id })
    .all().length;
}

/**
 * A fresh Aurora Coffee demo for one visitor, starting on the first milestone's date so the
 * first invoice is due "today".
 */
export function createDemoCopy(db: Db, ownerToken: string, now = new Date()) {
  const removed = cleanupDemoCopies(db, now);
  const projectId = seedDemoProject(db, { ownerToken, isDemo: true, demoToday: DEMO_STORY_TODAY });
  logAgentRun(db, {
    projectId,
    actor: "automation",
    action: "demo_created",
    result: { startsOn: DEMO_STORY_TODAY, expiredCopiesRemoved: removed },
    durationMs: 0,
    ok: true,
  });
  return projectId;
}
