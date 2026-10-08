import type { DependencyModel, Model, ProjectModel, Store, TaskModel } from "@bryntum/gantt";
import {
  daysBetween,
  expectedPayment,
  holdDate,
  localIsoDate,
  maxDate,
  type GateInvoice,
  type IsoDate,
} from "@/lib/gates";
import type { PaidTaskModel } from "./PaidTaskModel";

export type GateContext = {
  today: IsoDate;
  termsDays: number;
  /** Latest non-cancelled invoice per milestone task id. */
  invoicesByTask: Map<number, GateInvoice>;
};

export type GateResult = {
  changedTasks: number;
  /** Project finish before/after, as local calendar dates. */
  finishBefore: IsoDate | null;
  finishAfter: IsoDate | null;
};

const MAX_PASSES = 6;
const HOLD = "startnoearlierthan";

const isGate = (task: PaidTaskModel) => task.isMilestone && task.paymentGate && Boolean(task.amount);
const localMidnight = (date: IsoDate) => new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const asDate = (value: string | Date) => (typeof value === "string" ? new Date(value) : value);
const finishOf = (project: ProjectModel) => {
  const date = project.endDate ? asDate(project.endDate) : null;
  return date && !Number.isNaN(+date) ? localIsoDate(date) : null;
};

/** Local date of a task's end; null while the engine has not scheduled it yet. */
function taskEnd(task: PaidTaskModel): IsoDate | null {
  const value = task.endDate ?? task.startDate;
  if (!value) return null;
  const date = asDate(value);
  return Number.isNaN(+date) ? null : localIsoDate(date);
}

export function gateInputFor(task: PaidTaskModel, ctx: GateContext) {
  return {
    milestoneEnd: taskEnd(task) ?? ctx.today,
    invoice: ctx.invoicesByTask.get(Number(task.id)) ?? null,
    today: ctx.today,
    termsDays: ctx.termsDays,
  };
}

/** Human explanation of a hold, used for the indicator tooltip. */
export function describeHold(milestone: PaidTaskModel, ctx: GateContext) {
  if (!taskEnd(milestone)) return "Waiting for payment";
  const expectation = expectedPayment(gateInputFor(milestone, ctx));
  const name = milestone.name.replace(/^Milestone:\s*/i, "");
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    localMidnight(expectation.date),
  );
  switch (expectation.kind) {
    case "paid":
      return `Started after “${name}” was paid (${when})`;
    case "overdue":
      return `Waiting for overdue payment of “${name}” — sliding daily`;
    case "awaiting":
      return `Waiting for payment of “${name}” — due ${when}`;
    default:
      return `Waiting for payment of “${name}” — expected ${when} (invoice not sent yet)`;
  }
}

/** Gate milestone that currently holds this task, if any. */
export function holdingGate(task: PaidTaskModel, project: ProjectModel) {
  return (project.dependencyStore.records as DependencyModel[])
    .filter((dep) => dep.toTask === task)
    .map((dep) => dep.fromTask as PaidTaskModel)
    .find(isGate);
}

/**
 * Applies payment-gate holds to the successors of every gate milestone, in schedule
 * order, re-reading milestone dates after each commit so chained gates see the effect
 * of earlier holds. Changes persist through the CrudManager's autoSync.
 */
export async function applyPaymentGates(project: ProjectModel, ctx: GateContext): Promise<GateResult> {
  await project.commitAsync();
  const finishBefore = finishOf(project);
  const store = project.taskStore;
  const deps = project.dependencyStore.records as DependencyModel[];
  let changedTasks = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changedThisPass = 0;
    const gates = (store.query((t: Model) => isGate(t as PaidTaskModel)) as PaidTaskModel[]).sort(
      (a, b) => +asDate(a.endDate ?? 0) - +asDate(b.endDate ?? 0),
    );
    const desired = new Map<PaidTaskModel, IsoDate | null>();

    for (const gate of gates) {
      if (!taskEnd(gate)) continue;
      const hold = holdDate(gateInputFor(gate, ctx));
      for (const dep of deps.filter((d) => d.fromTask === gate)) {
        const successor = dep.toTask as PaidTaskModel;
        const previous = desired.get(successor);
        desired.set(successor, previous && hold ? maxDate(previous, hold) : (hold ?? previous ?? null));
      }
    }

    for (const [task, hold] of desired) {
      if (hold) {
        const current = task.constraintDate ? localIsoDate(asDate(task.constraintDate)) : null;
        if (task.gateHold !== hold || task.constraintType !== HOLD || current !== hold) {
          task.set({ constraintType: HOLD, constraintDate: localMidnight(hold), gateHold: hold });
          changedThisPass++;
        }
      } else if (task.gateHold) {
        // Only release constraints PaidPath placed itself.
        task.set({ constraintType: null, constraintDate: null, gateHold: null });
        changedThisPass++;
      }
    }

    if (!changedThisPass) break;
    changedTasks += changedThisPass;
    await project.commitAsync();
  }

  return { changedTasks, finishBefore, finishAfter: finishOf(project) };
}

/** Captures the current schedule as baseline 1 if the project has none yet. */
export function captureBaselineIfMissing(project: ProjectModel) {
  let hasBaseline = false;
  project.taskStore.traverse((task) => {
    if (((task as TaskModel).baselines as Store | undefined)?.count) hasBaseline = true;
  });
  if (hasBaseline) return false;
  project.taskStore.traverse((task) => (task as TaskModel).setBaseline(1));
  return true;
}

/** Latest baseline end across the plan, as a local date. */
export function baselineFinish(project: ProjectModel): IsoDate | null {
  let latest: Date | null = null;
  project.taskStore.traverse((record) => {
    const baseline = ((record as TaskModel).baselines as Store | undefined)?.first as { endDate?: Date } | undefined;
    if (baseline?.endDate && (!latest || baseline.endDate > latest)) latest = baseline.endDate;
  });
  return latest ? localIsoDate(latest) : null;
}

export const slipDays = (finish: IsoDate | null, baseline: IsoDate | null) =>
  finish && baseline ? daysBetween(baseline, finish) : null;
