export type ReminderTone = "friendly" | "firm" | "final";

export type ReminderInput = {
  /** Reminders already sent for this invoice. */
  reminderCount: number;
  /** Days past the due date (0 or negative when not overdue). */
  daysOverdue: number;
  amount: string;
  milestone: string;
  projectName: string;
};

export const MAX_REMINDER_NOTE = 1000;

/** Tone escalates with each reminder; a long-overdue first reminder is already firm. */
export function reminderTone({ reminderCount, daysOverdue }: Pick<ReminderInput, "reminderCount" | "daysOverdue">): ReminderTone {
  if (reminderCount >= 2) return "final";
  if (reminderCount === 1 || daysOverdue > 14) return "firm";
  return "friendly";
}

export function reminderSubject(input: ReminderInput) {
  const prefix = { friendly: "Reminder", firm: "Payment overdue", final: "Final notice" }[reminderTone(input)];
  return `${prefix}: ${input.milestone} — ${input.projectName}`;
}

/** Deterministic note used when the copilot did not write one (and for the Remind button). */
export function templateReminder(input: ReminderInput) {
  const late = input.daysOverdue > 0 ? ` and is now ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} past due` : "";
  switch (reminderTone(input)) {
    case "friendly":
      return `A friendly reminder that the invoice for "${input.milestone}" (${input.amount}) is still open${late}. You can pay securely via PayPal — thank you!`;
    case "firm":
      return `The invoice for "${input.milestone}" (${input.amount}) remains unpaid${late}. The next phase of ${input.projectName} is scheduled to start once this payment arrives, so please settle it via PayPal at your earliest convenience.`;
    case "final":
      return `Final notice: the invoice for "${input.milestone}" (${input.amount}) is still unpaid${late}. Work on the next phase of ${input.projectName} stays on hold until payment is received. Please pay via PayPal today or reply if there is an issue.`;
  }
}

/** Uses the copilot's note when it is usable, otherwise the tone template. */
export function reminderNote(input: ReminderInput, note?: string | null) {
  const custom = note?.trim();
  return custom ? custom.slice(0, MAX_REMINDER_NOTE) : templateReminder(input);
}
