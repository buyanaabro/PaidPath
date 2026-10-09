import { connection } from "next/server";
import { getDb } from "@/db/client";
import { loadProject } from "@/server/gantt/crud";
import { projectByToken } from "@/server/portal";

const fail = (status: number, message: string) => Response.json({ success: false, message }, { status });

// GET — CrudManager load for the read-only portal Gantt. There is deliberately no POST (sync).
export async function GET(_req: Request, ctx: RouteContext<"/api/portal/[token]/gantt">) {
  await connection();
  const db = getDb();
  const project = projectByToken(db, (await ctx.params).token);
  if (!project) return fail(404, "This link is not valid.");
  const response = loadProject(db, project.id);
  return response ? Response.json(response, { headers: { "Cache-Control": "no-store" } }) : fail(404, "Project not found");
}
