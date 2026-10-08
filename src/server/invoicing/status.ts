import type { InvoiceStatus } from "@/db/schema";

const MAP: Record<string, InvoiceStatus> = {
  DRAFT: "draft",
  SCHEDULED: "sent",
  SENT: "sent",
  UNPAID: "sent",
  PAYMENT_PENDING: "sent",
  PARTIALLY_PAID: "sent",
  PAID: "paid",
  MARKED_AS_PAID: "paid",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "refunded",
  MARKED_AS_REFUNDED: "refunded",
};

/** Maps a PayPal invoice status to PaidPath's smaller status set. */
export function toAppStatus(paypalStatus: string): InvoiceStatus {
  return MAP[paypalStatus.toUpperCase()] ?? "sent";
}

/** Invoices whose PayPal status can still change on its own (e.g. the client pays). */
export const isOpen = (status: InvoiceStatus) => status === "sent";

/** Statuses that block sending another invoice for the same milestone. */
export const blocksNewInvoice = (status: InvoiceStatus) =>
  status === "draft" || status === "sent" || status === "paid";

/** The value mirrored onto the milestone task for the Gantt. */
export const toTaskInvoiceStatus = (status: InvoiceStatus) =>
  status === "draft" ? "none" : status === "refunded" ? "cancelled" : status;
