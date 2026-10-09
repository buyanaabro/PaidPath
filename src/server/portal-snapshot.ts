import type { Db } from "@/db/client";
import type { Project } from "@/db/schema";
import { discountView } from "@/lib/discount";
import { isSimulated, projectToday } from "@/server/clock";
import { listProjectInvoices, milestoneStatuses, refreshProjectInvoices } from "@/server/invoicing/service";

export type PortalInvoice = {
  id: number;
  taskId: number | null;
  number: string | null;
  milestone: string;
  amountCents: number;
  currency: string;
  status: string;
  overdue: boolean;
  sentAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paidAmountCents: number | null;
  payUrl: string | null;
  hasQr: boolean;
  discount: ReturnType<typeof discountView>;
};

/**
 * What the client may see: their project's money timeline. Never the PayPal merchant link
 * (`invoicerUrl`), notes, reminder history, emails or the agent log.
 */
export function portalSnapshot(db: Db, project: Project, now = new Date()) {
  const today = projectToday(project, now);
  const invoiceRows: PortalInvoice[] = listProjectInvoices(db, project.id, now)
    .filter((i) => i.status !== "draft" && i.status !== "cancelled")
    .map((i) => ({
      id: i.id,
      taskId: i.taskId,
      number: i.invoiceNumber,
      milestone: i.milestoneName.replace(/^Milestone:\s*/i, ""),
      amountCents: i.amountCents,
      currency: i.currency,
      status: i.status,
      overdue: i.overdue,
      sentAt: i.sentAt,
      dueAt: i.dueAt,
      paidAt: i.paidAt,
      paidAmountCents: i.paidAmountCents,
      payUrl: i.payUrl,
      hasQr: i.hasQr,
      discount: discountView(i, today),
    }));
  return {
    project: {
      name: project.name,
      clientName: project.clientName,
      currency: project.currency,
      today,
      simulated: isSimulated(project),
      termsDays: project.paymentTermsDays,
    },
    invoices: invoiceRows,
    taskStatuses: milestoneStatuses(db, project.id),
  };
}

export type PortalSnapshot = ReturnType<typeof portalSnapshot>;

const REFRESH_MS = 15_000;
const lastRefresh = new Map<number, number>();

/** Public pages poll; PayPal is asked at most every 15 s per project. */
export async function refreshForPortal(db: Db, projectId: number, now = Date.now()) {
  if (now - (lastRefresh.get(projectId) ?? 0) < REFRESH_MS) return false;
  lastRefresh.set(projectId, now);
  await refreshProjectInvoices(db, projectId);
  return true;
}
