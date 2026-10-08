import { getDb } from "@/db/client";
import { InvoicingError, listProjectInvoices, milestoneStatuses } from "./service";

export const parseId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const fail = (status: number, message: string) => Response.json({ message }, { status });

/** Shared response shape: ledger rows + the milestone fields the Gantt mirrors. */
export function invoicesSnapshot(projectId: number) {
  const db = getDb();
  return {
    invoices: listProjectInvoices(db, projectId),
    taskStatuses: milestoneStatuses(db, projectId),
  };
}

export async function handleInvoicing(run: () => Promise<unknown>) {
  try {
    return Response.json(await run());
  } catch (error) {
    if (error instanceof InvoicingError) return fail(error.status, error.message);
    console.error("Invoicing request failed", error);
    return fail(500, "Something went wrong.");
  }
}
