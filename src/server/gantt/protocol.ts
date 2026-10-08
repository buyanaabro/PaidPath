import { z } from "zod";

// Bryntum CrudManager wire format (see docs: Gantt/guides/data/crud_manager_project.md).
export const PHANTOM_ID = "$PhantomId";

export type WireRow = Record<string, unknown>;

const rows = z.array(z.record(z.unknown())).optional();

const storeChanges = z
  .object({ added: rows, updated: rows, removed: rows })
  .optional();

export const SyncRequestSchema = z
  .object({
    type: z.literal("sync").optional(),
    requestId: z.union([z.number(), z.string()]).optional(),
    tasks: storeChanges,
    dependencies: storeChanges,
  })
  .passthrough();

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export type StoreResponse = {
  rows?: WireRow[];
  removed?: { id: number }[];
};

export type SyncResponse = {
  success: true;
  requestId?: number | string;
  tasks?: StoreResponse;
  dependencies?: StoreResponse;
};

export type LoadResponse = {
  success: true;
  project: { startDate: string };
  tasks: { rows: WireRow[] };
  dependencies: { rows: WireRow[] };
};
