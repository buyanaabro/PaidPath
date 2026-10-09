import { connection, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { parseDiscountOffer, type DiscountOffer } from "@/lib/discount";
import { depsFor, fail, handleInvoicing, invoicesSnapshot, parseId } from "@/server/invoicing/http";
import { invoiceMilestone, refreshProjectInvoices } from "@/server/invoicing/service";
import { getProject } from "@/server/projects";

type Context = RouteContext<"/api/projects/[projectId]/invoices">;

// GET ?refresh=1 pulls the latest statuses from PayPal first.
export async function GET(req: NextRequest, ctx: Context) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  if (!projectId || !getProject(getDb(), projectId)) return fail(404, "Project not found");
  return handleInvoicing(async () => {
    if (req.nextUrl.searchParams.get("refresh") === "1") {
      await refreshProjectInvoices(getDb(), projectId);
    }
    return invoicesSnapshot(projectId);
  });
}

// POST { taskId, discount?: { percent, days } } invoices a milestone through PayPal.
export async function POST(req: NextRequest, ctx: Context) {
  await connection();
  const projectId = parseId((await ctx.params).projectId);
  if (!projectId) return fail(404, "Project not found");
  const body = (await req.json().catch(() => null)) as { taskId?: unknown; discount?: unknown } | null;
  const taskId = parseId(String(body?.taskId ?? ""));
  if (!taskId) return fail(400, "taskId is required");
  let discount: DiscountOffer | null;
  try {
    discount = parseDiscountOffer(body?.discount);
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Invalid discount");
  }
  return handleInvoicing(async () => {
    const invoice = await invoiceMilestone(getDb(), projectId, taskId, depsFor(req), { discount });
    return { invoice: { id: invoice.id, status: invoice.status }, ...invoicesSnapshot(projectId) };
  });
}
