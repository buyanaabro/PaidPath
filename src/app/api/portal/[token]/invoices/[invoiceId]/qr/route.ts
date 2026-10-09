import { connection } from "next/server";
import { getDb } from "@/db/client";
import { fail, parseId } from "@/server/invoicing/http";
import { getInvoiceQr, InvoicingError } from "@/server/invoicing/service";
import { projectByToken } from "@/server/portal";

// GET — PayPal QR code for one of the portal project's invoices.
export async function GET(_req: Request, ctx: RouteContext<"/api/portal/[token]/invoices/[invoiceId]/qr">) {
  await connection();
  const params = await ctx.params;
  const db = getDb();
  const project = projectByToken(db, params.token);
  const invoiceId = parseId(params.invoiceId);
  if (!project || !invoiceId) return fail(404, "Invoice not found");
  try {
    const png = getInvoiceQr(db, project.id, invoiceId);
    if (!png) return fail(404, "No QR code for this invoice");
    return new Response(Buffer.from(png, "base64"), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof InvoicingError) return fail(error.status, error.message);
    throw error;
  }
}
