import { getDb } from "@/db/client";
import { defaultDeps, InvoicingError, listProjectInvoices, milestoneStatuses, type InvoicingDeps } from "./service";

/** Activity-feed attribution: the copilot tags its requests; anything else is the user. */
export const requestActor = (req: Request) =>
  req.headers.get("x-paidpath-actor") === "copilot" ? ("copilot" as const) : ("user" as const);

export const depsFor = (req: Request): InvoicingDeps => ({ ...defaultDeps, actor: requestActor(req) });

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
