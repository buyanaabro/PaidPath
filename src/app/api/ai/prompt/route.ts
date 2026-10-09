import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { modelChain } from "@/lib/ai";
import { QuotaRouter, RateLimiter } from "@/server/copilot/limits";
import { handlePrompt, type CopilotMode } from "@/server/copilot/proxy";
import { FixtureStore } from "@/server/copilot/replay";
import { parseId } from "@/server/invoicing/http";

// Free-tier guards (in-memory; the hosted demo runs one instance).
const [limit, windowSeconds] = (process.env.COPILOT_RATE_LIMIT ?? "10/600").split("/").map(Number);
const limiter = new RateLimiter(limit || 10, (windowSeconds || 600) * 1000);
const quota = new QuotaRouter(modelChain(), Number(process.env.COPILOT_MODEL_DAILY_CAP) || 16);
const fixtures = new FixtureStore(process.env.COPILOT_FIXTURES ?? "fixtures/copilot.json");
const mode = (["record", "replay"].includes(process.env.COPILOT_MODE ?? "")
  ? process.env.COPILOT_MODE
  : "live") as CopilotMode;

// POST ?projectId=… — Bryntum AI feature `promptUrl` (Gemini generateContent body).
export async function POST(req: NextRequest) {
  await connection();
  const projectId = parseId(req.nextUrl.searchParams.get("projectId") ?? "");
  if (!projectId) return Response.json({ error: { message: "projectId is required" } }, { status: 400 });
  const { status, json } = await handlePrompt(
    {
      projectId,
      visitor: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local",
      origin: req.headers.get("origin"),
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      rawBody: await req.text(),
    },
    {
      db: getDb(),
      fetch,
      now: () => new Date(),
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      allowedModels: modelChain(),
      quota,
      limiter,
      mode,
      fixtures,
    },
  );
  return Response.json(json, { status });
}
