import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_REMINDER_NOTE, reminderNote, reminderTone, templateReminder, type ReminderInput } from "./reminder";

const input: ReminderInput = {
  reminderCount: 0,
  daysOverdue: 0,
  amount: "$2,500",
  milestone: "Designs signed off",
  projectName: "Aurora Coffee — brand site",
};

describe("reminders", () => {
  test("tone escalates with reminders sent and long lateness", () => {
    assert.equal(reminderTone({ reminderCount: 0, daysOverdue: 3 }), "friendly");
    assert.equal(reminderTone({ reminderCount: 0, daysOverdue: 15 }), "firm");
    assert.equal(reminderTone({ reminderCount: 1, daysOverdue: 0 }), "firm");
    assert.equal(reminderTone({ reminderCount: 2, daysOverdue: 0 }), "final");
  });

  test("templates mention lateness and the hold on the next phase", () => {
    assert.match(templateReminder({ ...input, daysOverdue: 1 }), /now 1 day past due/);
    assert.doesNotMatch(templateReminder(input), /past due/);
    assert.match(templateReminder({ ...input, reminderCount: 2, daysOverdue: 9 }), /^Final notice: .*9 days past due.*on hold/);
  });

  test("a usable copilot note is trimmed and capped, otherwise the template is used", () => {
    assert.equal(reminderNote(input, "  Thanks!  "), "Thanks!");
    assert.equal(reminderNote(input, "x".repeat(5000)).length, MAX_REMINDER_NOTE);
    assert.equal(reminderNote(input, "   "), templateReminder(input));
    assert.equal(reminderNote(input, null), templateReminder(input));
  });
});
