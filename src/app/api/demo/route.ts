import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { RateLimiter } from "@/server/copilot/limits";
import { createDemoCopy } from "@/server/demo";
import { publicOrigin } from "@/server/invoicing/http";
import { ensureVisitor } from "@/server/visitor";

// Each visitor gets their own demo copy; keep creation bounded on the free instance.
const [limit, windowSeconds] = (process.env.DEMO_RATE_LIMIT ?? "10/3600").split("/").map(Number);
const limiter = new RateLimiter(limit || 10, (windowSeconds || 3600) * 1000);

// POST — creates a fresh Aurora Coffee demo copy for this visitor. HTML forms get a 303 to
// the workspace; `Accept: application/json` (E2E suite) gets { projectId, url }.
export async function POST(req: NextRequest) {
  await connection();
  const wantsJson = req.headers.get("accept")?.includes("application/json");
  const origin = publicOrigin(req);
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (!limiter.take(visitor, Date.now())) {
    return wantsJson
      ? Response.json({ message: "Too many demo projects — try again in a little while." }, { status: 429 })
      : Response.redirect(`${origin}/?demo=limit`, 303);
  }
  const projectId = createDemoCopy(getDb(), await ensureVisitor());
  const url = `${origin}/projects/${projectId}`;
  return wantsJson ? Response.json({ projectId, url }) : Response.redirect(url, 303);
}
