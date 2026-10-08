import { connection } from "next/server";
import { getDb } from "@/db/client";
import { fail, handleInvoicing, invoicesSnapshot, parseId } from "@/server/invoicing/http";
import { remindInvoice } from "@/server/invoicing/service";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/projects/[projectId]/invoices/[invoiceId]/remind">,
) {
  await connection();
  const params = await ctx.params;
  const projectId = parseId(params.projectId);
  const invoiceId = parseId(params.invoiceId);
  if (!projectId || !invoiceId) return fail(404, "Invoice not found");
  return handleInvoicing(async () => {
    await remindInvoice(getDb(), projectId, invoiceId);
    return invoicesSnapshot(projectId);
  });
}
