import { ProjectModel, type Model } from "@bryntum/gantt";
import { addDays, daysBetween, expectedPayment, localIsoDate, type IsoDate } from "@/lib/gates";
import { PaidTaskModel } from "./PaidTaskModel";
import { applyPaymentGates, gateInputFor, type GateContext } from "./payment-gates";

export type PaymentScenario = {
  paidAt: IsoDate;
  finish: IsoDate | null;
  /** Finish change vs the current plan in days (negative = earlier). */
  finishChangeDays: number | null;
  phasesMoved: { phase: string; startNow: IsoDate | undefined; startInScenario: IsoDate }[];
};

// Simulations run one at a time (each builds a full headless engine).
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

/**
 * Runs PaidPath's payment gates on a headless copy of the plan for hypothetical payment
 * dates of one milestone. The live project (owner Gantt or client portal) is never touched.
 */
export const simulatePayments = (live: ProjectModel, gate: GateContext, milestoneId: number, paidAts: IsoDate[]) =>
  serialized(() => runSimulation(live, gate, milestoneId, paidAts));

async function runSimulation(live: ProjectModel, gate: GateContext, milestoneId: number, paidAts: IsoDate[]) {
  const milestone = live.taskStore.getById(milestoneId) as PaidTaskModel | undefined;
  if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);
  const expected = expectedPayment(gateInputFor(milestone, gate)).date;
  const sim = new ProjectModel({ taskModelClass: PaidTaskModel, startDate: live.startDate });
  await sim.loadInlineData({
    calendars: live.calendarManagerStore.toJSON(),
    tasks: live.taskStore.toJSON(),
    dependencies: live.dependencyStore.toJSON(),
  });
  try {
    const phaseStarts = () =>
      new Map(
        (sim.taskStore.query((t: Model) => !(t as PaidTaskModel).isLeaf) as PaidTaskModel[])
          .filter((t) => t.startDate)
          .map((t) => [t.name, localIsoDate(t.startDate as Date)]),
      );
    const current = await applyPaymentGates(sim, gate);
    const before = phaseStarts();
    const scenarios: PaymentScenario[] = [];
    for (const paidAt of paidAts) {
      const invoicesByTask = new Map(gate.invoicesByTask);
      invoicesByTask.set(milestoneId, { status: "paid", dueAt: null, paidAt });
      const after = await applyPaymentGates(sim, { ...gate, invoicesByTask });
      scenarios.push({
        paidAt,
        finish: after.finishAfter,
        finishChangeDays: current.finishAfter && after.finishAfter ? daysBetween(current.finishAfter, after.finishAfter) : null,
        phasesMoved: [...phaseStarts()]
          .filter(([name, start]) => before.get(name) !== start)
          .map(([name, start]) => ({ phase: name, startNow: before.get(name), startInScenario: start })),
      });
    }
    return { milestone, expected, finishNow: current.finishAfter, scenarios };
  } finally {
    sim.destroy();
  }
}

/**
 * Launch days gained if a milestone invoiced today is paid on the last day of an
 * early-payment window instead of on its due date (today + terms).
 */
export async function discountBenefit(live: ProjectModel, gate: GateContext, milestoneId: number, windowDays: number) {
  const { scenarios } = await simulatePayments(live, gate, milestoneId, [
    addDays(gate.today, gate.termsDays),
    addDays(gate.today, windowDays),
  ]);
  const [onDue, inWindow] = scenarios;
  if (!onDue.finish || !inWindow.finish) return null;
  return { launchDaysEarlier: daysBetween(inWindow.finish, onDue.finish), finishIfEarly: inWindow.finish, finishOnDue: onDue.finish };
}
