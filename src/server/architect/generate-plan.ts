import { generateText, Output } from "ai";
import { getModel, modelChain, modelProviderOptions } from "@/lib/ai";
import { PlanSchema, type NormalizedPlan } from "./schema";
import { normalizePlan } from "./validate";

export type BriefInput = {
  brief: string;
  clientName: string;
  budgetCents: number;
  currency: string;
  startDate: string;
  /** Regeneration: what the user wants changed, plus the plan being revised. */
  feedback?: string;
  previousPlan?: NormalizedPlan;
};

const SYSTEM = `You are an experienced freelance project manager who turns client briefs
into realistic, billable project plans.

Rules:
- Split the work into 2 to 5 sequential phases. Each phase has 1 to 6 concrete tasks.
- Durations are whole working days between 1 and 10. Be realistic for a solo freelancer.
- Inside a phase, use dependsOn to reference keys of EARLIER tasks in the same phase only.
  Tasks that can run in parallel should not depend on each other.
- Every phase ends with one billable milestone: a deliverable the client approves and pays for.
  sharePercent is that milestone's share of the total budget; shares should add up to 100.
  The first milestone works like a deposit (15-30%); weight later ones by effort.
- Names are short (at most 40 characters), specific to the brief, in English.
- If the project includes online payments or checkout, plan it with PayPal.`;

function describePlan(plan: NormalizedPlan) {
  return plan.phases
    .map(
      (phase, i) =>
        `${i + 1}. ${phase.name}: ${phase.tasks.map((t) => `${t.name} (${t.durationDays}d)`).join(", ")} → ${phase.milestone.name}`,
    )
    .join("\n");
}

function buildPrompt(input: BriefInput) {
  const budget = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: input.currency,
  }).format(input.budgetCents / 100);
  const lines = [
    `Client: ${input.clientName}`,
    `Total budget: ${budget}`,
    `Planned start: ${input.startDate}`,
    "",
    "Client brief:",
    input.brief,
  ];
  if (input.previousPlan) {
    lines.push("", "Current plan (revise it):", describePlan(input.previousPlan));
  }
  if (input.feedback) lines.push("", `Requested changes: ${input.feedback}`);
  return lines.join("\n");
}

/** Calls the LLM and returns a normalized plan; on failure retries once on the fallback model. */
export async function generatePlan(input: BriefInput) {
  const prompt = buildPrompt(input);
  let lastError: unknown;

  for (const [index, model] of modelChain().entries()) {
    try {
      const { output } = await generateText({
        model: getModel(model),
        providerOptions: modelProviderOptions,
        output: Output.object({ schema: PlanSchema, name: "project_plan" }),
        system: SYSTEM,
        prompt,
        maxRetries: 1,
        // Fail over quickly from the primary; give the last model more room.
        abortSignal: AbortSignal.timeout(index === 0 ? 45_000 : 60_000),
      });
      return { plan: normalizePlan(output, input.budgetCents), attempts: index + 1, model };
    } catch (error) {
      lastError = error;
      console.warn(`Plan generation with ${model} failed:`, error instanceof Error ? error.message : error);
    }
  }
  throw new Error("The AI architect could not produce a plan. Please try again.", {
    cause: lastError,
  });
}
