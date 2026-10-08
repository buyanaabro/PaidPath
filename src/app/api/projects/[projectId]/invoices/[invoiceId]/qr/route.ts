import { connection } from "next/server";
import { getDb } from "@/db/client";
import { fail, parseId } from "@/server/invoicing/http";
import { getInvoiceQr, InvoicingError } from "@/server/invoicing/service";

// PayPal-generated QR code (PNG) that opens the client's pay page.
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/projects/[projectId]/invoices/[invoiceId]/qr">,
) {
  await connection();
  const params = await ctx.params;
  const projectId = parseId(params.projectId);
  const invoiceId = parseId(params.invoiceId);
  if (!projectId || !invoiceId) return fail(404, "Invoice not found");
  try {
    const png = getInvoiceQr(getDb(), projectId, invoiceId);
    if (!png) return fail(404, "No QR code for this invoice");
    return new Response(Buffer.from(png, "base64"), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof InvoicingError) return fail(error.status, error.message);
    throw error;
  }
}
