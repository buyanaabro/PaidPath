import { dependencies, tasks } from "@/db/schema";
import type { DbLike } from "@/db/client";

/** Storage-agnostic plan shape shared by the demo seed and the AI architect. */
export type PlanNode = {
  key: string;
  name: string;
  startDate?: string;
  duration?: number;
  amountCents?: number;
  invoiceStatus?: string;
  paymentGate?: boolean;
  children?: PlanNode[];
};

export type PlanTree = {
  nodes: PlanNode[];
  links: { from: string; to: string }[];
};

/** Inserts a plan tree for a project; returns the key → task id mapping. */
export function insertPlanTree(db: DbLike, projectId: number, plan: PlanTree) {
  const ids = new Map<string, number>();

  const insertNodes = (nodes: PlanNode[], parentId: number | null) =>
    nodes.forEach((node, orderIndex) => {
      const { id } = db
        .insert(tasks)
        .values({
          projectId,
          parentId,
          orderIndex,
          name: node.name,
          startDate: node.startDate ?? null,
          duration: node.children?.length ? null : (node.duration ?? 1),
          amountCents: node.amountCents ?? null,
          invoiceStatus: node.invoiceStatus ?? "none",
          paymentGate: node.paymentGate ?? false,
        })
        .returning({ id: tasks.id })
        .get();
      ids.set(node.key, id);
      if (node.children) insertNodes(node.children, id);
    });

  insertNodes(plan.nodes, null);

  for (const link of plan.links) {
    const fromTaskId = ids.get(link.from);
    const toTaskId = ids.get(link.to);
    if (fromTaskId === undefined || toTaskId === undefined) {
      throw new Error(`Plan link references unknown key: ${link.from} → ${link.to}`);
    }
    db.insert(dependencies).values({ projectId, fromTaskId, toTaskId }).run();
  }

  return ids;
}
