import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { listActivity } from "@/server/activity";
import { fail, parseId } from "@/server/invoicing/http";
import { getProject } from "@/server/projects";

// GET ?after=<id> — the project's agent activity feed (newest first).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/activity">) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  const db = getDb();
  if (!projectId || !getProject(db, projectId)) return fail(404, "Project not found");
  const after = parseId(req.nextUrl.searchParams.get("after") ?? "") ?? undefined;
  return Response.json({ items: listActivity(db, projectId, { afterId: after }) });
}
