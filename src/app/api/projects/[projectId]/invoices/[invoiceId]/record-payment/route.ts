import { connection } from "next/server";
import { getDb } from "@/db/client";
import { depsFor, fail, handleInvoicing, invoicesSnapshot, parseId } from "@/server/invoicing/http";
import { recordDemoPayment } from "@/server/invoicing/service";

// Sandbox demo only: records a full manual payment on the PayPal invoice.
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/projects/[projectId]/invoices/[invoiceId]/record-payment">,
) {
  await connection();
  const params = await ctx.params;
  const projectId = parseId(params.projectId);
  const invoiceId = parseId(params.invoiceId);
  if (!projectId || !invoiceId) return fail(404, "Invoice not found");
  return handleInvoicing(async () => {
    await recordDemoPayment(getDb(), projectId, invoiceId, depsFor(req));
    return invoicesSnapshot(projectId);
  });
}
