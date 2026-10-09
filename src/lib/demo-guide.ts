// The five-step demo checklist shown on demo copies. Steps tick off from real state.

export type GuideInput = {
  invoices: { status: string; overdue: boolean }[];
  /** Agent activity actions (newest first is fine). */
  actions: string[];
};

export const DEMO_STEPS = [
  {
    id: "send",
    title: "Send the first invoice",
    hint: "Click “Send invoice” on “Direction approved” in the Invoice column — keep the suggested early-payment discount.",
    done: (input: GuideInput) => input.invoices.some((i) => i.status !== "draft"),
  },
  {
    id: "client",
    title: "Open Client view",
    hint: "Click “Client view ↗” in the header to see your client's page — including “Pay today → launch moves to …”.",
    done: (input: GuideInput) => input.actions.includes("portal_viewed"),
  },
  {
    id: "pay",
    title: "Record the payment",
    hint: "In “PayPal invoices” below, click “Record payment” — the Design phase pulls in and the launch moves earlier.",
    done: (input: GuideInput) => input.invoices.some((i) => i.status === "paid"),
  },
  {
    id: "overdue",
    title: "Let a payment run late",
    hint: "Send the next milestone's invoice, then press +1w on the demo clock until it turns overdue — the plan slips a day per day.",
    done: (input: GuideInput) => input.invoices.some((i) => i.overdue),
  },
  {
    id: "copilot",
    title: "Ask the copilot",
    hint: "Open the chat (bottom right) and ask “What if Aurora pays a week late?” or “Chase the overdue invoice”.",
    done: (input: GuideInput) => input.actions.includes("copilot_turn"),
  },
] as const;

export function guideProgress(input: GuideInput) {
  const steps = DEMO_STEPS.map(({ id, title, hint, done }) => ({ id, title, hint, done: done(input) }));
  const current = steps.find((s) => !s.done) ?? null;
  return { steps, current, completed: steps.filter((s) => s.done).length };
}
