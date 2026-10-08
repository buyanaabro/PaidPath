import type { Project } from "@/db/schema";
import { toIsoDate, type IsoDate } from "@/lib/gates";

type ClockProject = Pick<Project, "demoToday">;

/** The project's "today": its demo clock when set, otherwise the real (UTC) date. */
export const projectToday = (project: ClockProject, now = new Date()): IsoDate =>
  project.demoToday ?? toIsoDate(now.toISOString());

/**
 * A timestamp in the project's time frame, used for invoice dates (sent/due/paid).
 * Simulated days are pinned to noon UTC so the calendar date is stable in any timezone.
 */
export const projectNow = (project: ClockProject, now = new Date()): Date =>
  project.demoToday ? new Date(`${project.demoToday}T12:00:00.000Z`) : now;

export const isSimulated = (project: ClockProject) => project.demoToday !== null;
