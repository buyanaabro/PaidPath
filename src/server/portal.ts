import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentLog, projects } from "@/db/schema";
import { logAgentRun } from "@/server/projects";

/** 24 random bytes → 32-char URL-safe capability token. */
export const newShareToken = () => randomBytes(24).toString("base64url");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const portalPath = (token: string) => `/p/${token}`;

/** The project's portal token, created on first use. */
export function ensureShareToken(db: Db, projectId: number) {
  const project = db.select({ shareToken: projects.shareToken }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return null;
  if (project.shareToken) return project.shareToken;
  const token = newShareToken();
  db.update(projects).set({ shareToken: token }).where(eq(projects.id, projectId)).run();
  return token;
}

/** Issues a new token; the old link stops working. */
export function rotateShareToken(db: Db, projectId: number) {
  const token = newShareToken();
  db.update(projects).set({ shareToken: token }).where(eq(projects.id, projectId)).run();
  return token;
}

export function projectByToken(db: Db, token: string) {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  return db.select().from(projects).where(eq(projects.shareToken, token)).get();
}

const VISIT_WINDOW_MS = 60 * 60_000;

/** Logs "Client opened the portal" at most once per hour per project. */
export function recordPortalVisit(db: Db, projectId: number, now = new Date()) {
  const since = new Date(now.getTime() - VISIT_WINDOW_MS).toISOString();
  const recent = db
    .select({ id: agentLog.id })
    .from(agentLog)
    .where(and(eq(agentLog.projectId, projectId), eq(agentLog.action, "portal_viewed"), gt(agentLog.ts, since)))
    .get();
  if (recent) return false;
  logAgentRun(db, { projectId, actor: "client", action: "portal_viewed", durationMs: 0, ok: true });
  return true;
}
