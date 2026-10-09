import { connection } from "next/server";
import { getDb } from "@/db/client";
import { depsFor, fail, handleInvoicing, invoicesSnapshot, parseId } from "@/server/invoicing/http";
import { remindInvoice } from "@/server/invoicing/service";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/projects/[projectId]/invoices/[invoiceId]/remind">,
) {
  await connection();
  const params = await ctx.params;
  const projectId = parseId(params.projectId);
  const invoiceId = parseId(params.invoiceId);
  if (!projectId || !invoiceId) return fail(404, "Invoice not found");
  // Optional { note } — the copilot's reminder text; otherwise a tone template is used.
  const body = (await req.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note : null;
  return handleInvoicing(async () => {
    await remindInvoice(getDb(), projectId, invoiceId, depsFor(req), { note });
    return invoicesSnapshot(projectId);
  });
}
