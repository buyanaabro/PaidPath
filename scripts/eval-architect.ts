// Runs fixture briefs through the real AI architect and checks plan invariants.
// Run: npm run eval:architect   (makes real Gemini calls)
import { loadEnvConfig } from "@next/env";
import { generatePlan } from "../src/server/architect/generate-plan";
import { materializePlan } from "../src/server/architect/materialize";
import { LIMITS } from "../src/server/architect/validate";

loadEnvConfig(process.cwd());

const fixtures = [
  {
    clientName: "Aurora Coffee",
    budgetCents: 700_000,
    brief:
      "Specialty coffee roaster needs a new brand website with an online shop for beans and subscriptions, a story page about their farms, and a launch-ready SEO setup.",
  },
  {
    clientName: "FitLoop",
    budgetCents: 1_800_000,
    brief:
      "Build an MVP mobile app (iOS + Android) for booking local fitness classes: class discovery map, booking and payments, push reminders, and a simple studio admin dashboard.",
  },
  {
    clientName: "Greenleaf Dental",
    budgetCents: 450_000,
    brief:
      "Three-month marketing campaign for a dental clinic opening a second location: campaign strategy, photo shoot, social ads, a landing page with booking, and a launch event.",
  },
];

async function main() {
let failures = 0;

for (const fixture of fixtures) {
  const started = Date.now();
  const { plan, attempts } = await generatePlan({
    ...fixture,
    currency: "USD",
    startDate: "2026-11-02",
  });
  const tree = materializePlan(plan);
  const tasks = plan.phases.flatMap((p) => p.tasks);
  const keysSeen = plan.phases.map(() => new Set<string>());
  const checks = {
    phases: plan.phases.length >= LIMITS.minPhases && plan.phases.length <= LIMITS.maxPhases,
    durations: tasks.every((t) => t.durationDays >= 1 && t.durationDays <= 10),
    acyclic: plan.phases.every((p, i) =>
      p.tasks.every((t) => {
        const ok = t.dependsOn.every((d) => keysSeen[i].has(d));
        keysSeen[i].add(t.key);
        return ok;
      }),
    ),
    budget: plan.phases.reduce((n, p) => n + p.milestone.amountCents, 0) === fixture.budgetCents,
    milestones: plan.phases.every((p) => p.milestone.amountCents > 0),
    taskCap: tasks.length <= LIMITS.maxTasks,
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;

  console.log(`\n${ok ? "PASS" : "FAIL"} ${fixture.clientName} — "${plan.projectName}" (${((Date.now() - started) / 1000).toFixed(1)}s, ${attempts} attempt)`);
  console.log("  checks:", checks);
  for (const phase of plan.phases) {
    console.log(
      `  • ${phase.name} [${phase.tasks.map((t) => `${t.name} ${t.durationDays}d`).join(", ")}] → ${phase.milestone.name} $${phase.milestone.amountCents / 100}`,
    );
  }
  console.log(`  links: ${tree.links.length}`);
}

console.log(failures ? `\nEVAL_FAILED (${failures})` : "\nEVAL_OK");
process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error("EVAL_ERROR", error);
  process.exit(1);
});
