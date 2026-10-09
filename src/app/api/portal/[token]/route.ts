import { connection } from "next/server";
import { getDb } from "@/db/client";
import { fail } from "@/server/invoicing/http";
import { projectByToken } from "@/server/portal";
import { getProject } from "@/server/projects";
import { portalSnapshot, refreshForPortal } from "@/server/portal-snapshot";

// GET — the client portal's live snapshot (read-only; PayPal refreshed at most every 15 s).
export async function GET(_req: Request, ctx: RouteContext<"/api/portal/[token]">) {
  await connection();
  const db = getDb();
  const project = projectByToken(db, (await ctx.params).token);
  if (!project) return fail(404, "This link is not valid.");
  await refreshForPortal(db, project.id).catch((error) => console.warn("Portal refresh failed", error));
  // Re-read: the refresh may have expired discounts or recorded payments.
  return Response.json(portalSnapshot(db, getProject(db, project.id)!), {
    headers: { "Cache-Control": "no-store" },
  });
}
