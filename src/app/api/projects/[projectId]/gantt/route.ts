import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { loadProject, syncProject } from "@/server/gantt/crud";
import { SyncRequestSchema } from "@/server/gantt/protocol";

// Bryntum CrudManager endpoint: GET = load, POST = sync.
type Context = RouteContext<"/api/projects/[projectId]/gantt">;

const fail = (status: number, message: string) =>
  Response.json({ success: false, message }, { status });

async function projectIdFrom(ctx: Context) {
  const id = Number((await ctx.params).projectId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: NextRequest, ctx: Context) {
  await connection();
  const projectId = await projectIdFrom(ctx);
  if (!projectId) return fail(400, "Invalid project id");

  const response = loadProject(getDb(), projectId);
  return response ? Response.json(response) : fail(404, "Project not found");
}

export async function POST(req: NextRequest, ctx: Context) {
  await connection();
  const projectId = await projectIdFrom(ctx);
  if (!projectId) return fail(400, "Invalid project id");

  const parsed = SyncRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Malformed sync request");

  try {
    return Response.json(syncProject(getDb(), projectId, parsed.data));
  } catch (error) {
    console.error("Gantt sync failed", error);
    return fail(500, "Could not save changes");
  }
}
