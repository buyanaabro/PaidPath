import { z } from "zod";

// What the LLM returns. Constraints are guidance in descriptions; `normalizePlan`
// enforces them, so a slightly-off answer is repaired instead of rejected.
export const PlanSchema = z.object({
  projectName: z.string().describe("Short project name, at most 40 characters"),
  phases: z
    .array(
      z.object({
        name: z.string().describe("Phase name, at most 40 characters"),
        tasks: z
          .array(
            z.object({
              key: z.string().describe("Short unique id within the phase, e.g. t1"),
              name: z.string().describe("Task name, at most 40 characters"),
              durationDays: z.number().describe("Whole working days, 1 to 10"),
              dependsOn: z
                .array(z.string())
                .describe("Keys of EARLIER tasks in the same phase this task waits for"),
            }),
          )
          .describe("1 to 6 tasks"),
        milestone: z.object({
          name: z.string().describe("Billable deliverable that closes the phase"),
          sharePercent: z.number().describe("Share of the total budget billed at this milestone"),
        }),
      }),
    )
    .describe("2 to 5 sequential phases"),
});

export type RawPlan = z.infer<typeof PlanSchema>;

export type NormalizedTask = {
  key: string;
  name: string;
  durationDays: number;
  dependsOn: string[];
};

export type NormalizedPlan = {
  projectName: string;
  phases: {
    name: string;
    tasks: NormalizedTask[];
    milestone: { name: string; amountCents: number };
  }[];
};
