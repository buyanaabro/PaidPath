import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { callPayPalTool } from "@/lib/paypal";
import { summarizeTransactions, transactionRange } from "@/server/copilot/paypal-activity";
import { fail, parseId } from "@/server/invoicing/http";
import { getProject } from "@/server/projects";

// GET ?days=30 — recent PayPal account transactions (Transaction Search API), summarized.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/paypal/activity">) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  if (!projectId || !getProject(getDb(), projectId)) return fail(404, "Project not found");
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  try {
    const raw = await callPayPalTool("list_transactions", transactionRange(days));
    return Response.json(summarizeTransactions(raw));
  } catch (error) {
    console.error("PayPal transaction search failed", error);
    return fail(502, "PayPal transaction search is unavailable right now.");
  }
}
