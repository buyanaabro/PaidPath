import type { ProjectModel } from "@bryntum/gantt";
import type { IsoDate } from "@/lib/gates";

const TODAY_RANGE_ID = "pp-today";

/** Local-only "Today" line at the project's (possibly simulated) date. */
export function showToday(project: ProjectModel, today: IsoDate, simulated: boolean) {
  const store = project.timeRangeStore;
  const [y, m, d] = today.split("-").map(Number);
  const values = {
    name: simulated ? "Today (demo clock)" : "Today",
    startDate: new Date(y, m - 1, d),
    duration: 0,
    cls: simulated ? "pp-today pp-today-simulated" : "pp-today",
  };
  const existing = store.getById(TODAY_RANGE_ID);
  if (existing) existing.set(values);
  else store.add({ id: TODAY_RANGE_ID, ...values });
}
