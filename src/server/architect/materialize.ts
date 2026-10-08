import type { PlanTree } from "@/server/plan-tree";
import type { NormalizedPlan } from "./schema";

/**
 * Turns a normalized plan into a Gantt tree: root → phases → tasks + a priced
 * milestone per phase. Every milestone except the last gates the next phase, so
 * work cannot start before the previous phase's invoice is paid (Phase 4).
 * Dates are left to Bryntum's scheduling engine (dependencies + project start).
 */
export function materializePlan(plan: NormalizedPlan): PlanTree {
  const links: PlanTree["links"] = [];
  const lastIndex = plan.phases.length - 1;

  const phaseNodes = plan.phases.map((phase, i) => {
    const key = (taskKey: string) => `p${i}:${taskKey}`;
    const milestoneKey = `p${i}:milestone`;
    const previousMilestone = i > 0 ? `p${i - 1}:milestone` : null;
    const hasSuccessor = new Set(phase.tasks.flatMap((t) => t.dependsOn));

    for (const task of phase.tasks) {
      for (const dep of task.dependsOn) links.push({ from: key(dep), to: key(task.key) });
      if (!task.dependsOn.length && previousMilestone) {
        links.push({ from: previousMilestone, to: key(task.key) });
      }
      if (!hasSuccessor.has(task.key)) links.push({ from: key(task.key), to: milestoneKey });
    }

    return {
      key: `p${i}`,
      name: phase.name,
      children: [
        ...phase.tasks.map((task) => ({
          key: key(task.key),
          name: task.name,
          duration: task.durationDays,
        })),
        {
          key: milestoneKey,
          name: `Milestone: ${phase.milestone.name}`,
          duration: 0,
          amountCents: phase.milestone.amountCents,
          paymentGate: i < lastIndex,
        },
      ],
    };
  });

  return {
    nodes: [{ key: "root", name: plan.projectName, children: phaseNodes }],
    links,
  };
}
