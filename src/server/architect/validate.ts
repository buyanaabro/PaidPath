import type { NormalizedPlan, NormalizedTask, RawPlan } from "./schema";

export const LIMITS = {
  minPhases: 2,
  maxPhases: 5,
  maxTasksPerPhase: 6,
  maxTasks: 25,
  minDuration: 1,
  maxDuration: 10,
  maxNameLength: 60,
};

export class PlanValidationError extends Error {}

const clean = (value: string, fallback: string) =>
  value.trim().replace(/\s+/g, " ").slice(0, LIMITS.maxNameLength) || fallback;

/** Splits `totalCents` by weights so the parts sum exactly (largest remainder). */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  // Bill whole dollars when the budget is whole dollars.
  const unit = totalCents % 100 === 0 ? 100 : 1;
  const units = totalCents / unit;
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  const sum = safe.reduce((a, b) => a + b, 0);
  const exact = safe.map((w) => (w / sum) * units);
  const parts = exact.map(Math.floor);
  let leftover = units - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; leftover > 0; i = (i + 1) % byRemainder.length, leftover--) {
    parts[byRemainder[i].index] += 1;
  }
  return parts.map((p) => p * unit);
}

/** Repairs and bounds an LLM plan so it is always safe to materialize. */
export function normalizePlan(raw: RawPlan, budgetCents: number): NormalizedPlan {
  const phases = raw.phases
    .slice(0, LIMITS.maxPhases)
    .map((phase) => ({ ...phase, tasks: phase.tasks.slice(0, LIMITS.maxTasksPerPhase) }))
    .filter((phase) => phase.tasks.length > 0);

  if (phases.length < LIMITS.minPhases) {
    throw new PlanValidationError(
      `Plan needs at least ${LIMITS.minPhases} phases with tasks (got ${phases.length})`,
    );
  }

  // Trim the longest phases until the total task count fits.
  while (phases.reduce((n, p) => n + p.tasks.length, 0) > LIMITS.maxTasks) {
    const longest = phases.reduce((a, b) => (b.tasks.length > a.tasks.length ? b : a));
    longest.tasks = longest.tasks.slice(0, -1);
  }

  const amounts = allocateCents(
    budgetCents,
    phases.map((p) => p.milestone.sharePercent),
  );

  return {
    projectName: clean(raw.projectName, "New project"),
    phases: phases.map((phase, phaseIndex) => {
      const seen = new Set<string>();
      const tasks: NormalizedTask[] = phase.tasks.map((task, taskIndex) => {
        let key = clean(task.key, `t${taskIndex + 1}`);
        if (seen.has(key)) key = `${key}-${taskIndex + 1}`;
        // Only earlier tasks in the same phase are valid predecessors → always acyclic.
        const dependsOn = [...new Set(task.dependsOn.map((d) => d.trim()))].filter((d) =>
          seen.has(d),
        );
        seen.add(key);
        return {
          key,
          name: clean(task.name, `Task ${taskIndex + 1}`),
          durationDays: Math.min(
            LIMITS.maxDuration,
            Math.max(LIMITS.minDuration, Math.round(Number(task.durationDays) || 1)),
          ),
          dependsOn,
        };
      });
      return {
        name: clean(phase.name, `Phase ${phaseIndex + 1}`),
        tasks,
        milestone: {
          name: clean(phase.milestone.name, `${clean(phase.name, "Phase")} delivered`),
          amountCents: amounts[phaseIndex],
        },
      };
    }),
  };
}
