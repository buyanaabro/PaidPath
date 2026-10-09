import { eq } from "drizzle-orm";
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { addDays, daysBetween, toIsoDate } from "@/lib/gates";
import { isSimulated, projectToday } from "@/server/clock";
import { fail, invoicesSnapshot, parseId, requestActor } from "@/server/invoicing/http";
import { getProject, logAgentRun } from "@/server/projects";

// Per-project demo clock: { today: "YYYY-MM-DD" | null } or { shiftDays: n }.
const ClockRequest = z.union([
  z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  z.object({ shiftDays: z.number().int().min(-60).max(60) }),
]);

const MAX_DRIFT_DAYS = 365;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/clock">) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  const db = getDb();
  const project = projectId ? getProject(db, projectId) : undefined;
  if (!projectId || !project) return fail(404, "Project not found");

  const parsed = ClockRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Send { today: 'YYYY-MM-DD' | null } or { shiftDays: n }");

  const realToday = toIsoDate(new Date().toISOString());
  const next =
    "shiftDays" in parsed.data ? addDays(projectToday(project), parsed.data.shiftDays) : parsed.data.today;
  if (next && Math.abs(daysBetween(realToday, next)) > MAX_DRIFT_DAYS) {
    return fail(400, "The demo clock can move at most a year from today.");
  }
  // Moving back to the real date clears the simulation.
  const demoToday = next === realToday ? null : next;

  db.update(projects).set({ demoToday }).where(eq(projects.id, projectId)).run();
  logAgentRun(db, {
    projectId,
    actor: requestActor(req),
    action: "clock_changed",
    payload: { from: project.demoToday, to: demoToday },
    durationMs: 0,
    ok: true,
  });

  const updated = getProject(db, projectId)!;
  return Response.json({
    clock: { today: projectToday(updated), simulated: isSimulated(updated) },
    ...invoicesSnapshot(projectId),
  });
}
