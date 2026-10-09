import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { fail, parseId, publicOrigin } from "@/server/invoicing/http";
import { ensureShareToken, portalPath, rotateShareToken } from "@/server/portal";
import { getProject, logAgentRun } from "@/server/projects";

// POST { rotate?: true } — the client-portal link for this project (rotating revokes the old one).
export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/share">) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  const db = getDb();
  if (!projectId || !getProject(db, projectId)) return fail(404, "Project not found");
  const body = (await req.json().catch(() => null)) as { rotate?: unknown } | null;
  const rotate = body?.rotate === true;
  const token = rotate ? rotateShareToken(db, projectId) : ensureShareToken(db, projectId)!;
  if (rotate) logAgentRun(db, { projectId, actor: "user", action: "portal_link_rotated", durationMs: 0, ok: true });
  return Response.json({ url: `${publicOrigin(req)}${portalPath(token)}`, path: portalPath(token) });
}
