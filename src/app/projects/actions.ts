"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { generatePlan } from "@/server/architect/generate-plan";
import {
  acceptProjectPlan,
  createDraftProject,
  currentPlanOutline,
  getProject,
  logAgentRun,
  replaceProjectPlan,
} from "@/server/projects";
import { ensureVisitor } from "@/server/visitor";

const BriefFormSchema = z.object({
  name: z.string().trim().max(80).optional(),
  clientName: z.string().trim().min(1, "Client name is required").max(80),
  clientEmail: z.string().trim().email("Enter a valid client email"),
  budget: z.coerce
    .number({ invalid_type_error: "Budget must be a number" })
    .min(100, "Budget must be at least $100")
    .max(1_000_000, "Budget must be at most $1,000,000"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  paymentTermsDays: z.coerce
    .number()
    .refine((days) => [7, 14, 30].includes(days), "Pick 7, 14 or 30 days"),
  brief: z
    .string()
    .trim()
    .min(20, "Describe the project in at least 20 characters")
    .max(4000, "Keep the brief under 4,000 characters"),
});

export type BriefFormState = { error?: string; fieldErrors?: Record<string, string> };

export async function createProjectFromBrief(
  _prev: BriefFormState,
  formData: FormData,
): Promise<BriefFormState> {
  const parsed = BriefFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
    );
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }

  const input = parsed.data;
  const budgetCents = Math.round(input.budget * 100);
  const db = getDb();
  const started = Date.now();
  let projectId: number;

  try {
    const { plan, attempts, model } = await generatePlan({
      brief: input.brief,
      clientName: input.clientName,
      budgetCents,
      currency: "USD",
      startDate: input.startDate,
    });
    projectId = createDraftProject(
      db,
      {
        name: input.name,
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        budgetCents,
        currency: "USD",
        startDate: input.startDate,
        paymentTermsDays: input.paymentTermsDays,
        briefText: input.brief,
        ownerToken: await ensureVisitor(),
      },
      plan,
    );
    logAgentRun(db, {
      projectId,
      actor: "architect",
      action: "create_plan",
      payload: { budgetCents, startDate: input.startDate, briefLength: input.brief.length },
      result: { model, attempts, phases: plan.phases.length },
      durationMs: Date.now() - started,
      ok: true,
    });
  } catch (error) {
    logAgentRun(db, {
      actor: "architect",
      action: "create_plan",
      result: { error: String(error) },
      durationMs: Date.now() - started,
      ok: false,
    });
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }

  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

export async function regeneratePlan(projectId: number, feedback: string) {
  const db = getDb();
  const project = getProject(db, projectId);
  if (!project?.briefText) return { error: "This project has no brief to regenerate from." };

  const started = Date.now();
  try {
    const { plan, attempts, model } = await generatePlan({
      brief: project.briefText,
      clientName: project.clientName,
      budgetCents: project.budgetCents,
      currency: project.currency,
      startDate: project.startDate,
      feedback: feedback.trim().slice(0, 500) || undefined,
      previousPlan: currentPlanOutline(db, projectId),
    });
    replaceProjectPlan(db, projectId, plan);
    logAgentRun(db, {
      projectId,
      actor: "architect",
      action: "regenerate_plan",
      payload: { feedback },
      result: { model, attempts, phases: plan.phases.length },
      durationMs: Date.now() - started,
      ok: true,
    });
  } catch (error) {
    logAgentRun(db, {
      projectId,
      actor: "architect",
      action: "regenerate_plan",
      payload: { feedback },
      result: { error: String(error) },
      durationMs: Date.now() - started,
      ok: false,
    });
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const };
}

export async function acceptPlan(projectId: number) {
  acceptProjectPlan(getDb(), projectId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}
