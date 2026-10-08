import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db, DbLike } from "@/db/client";
import { dependencies, projects, tasks, type NewTask, type Task } from "@/db/schema";
import {
  PHANTOM_ID,
  type LoadResponse,
  type StoreResponse,
  type SyncRequest,
  type SyncResponse,
  type WireRow,
} from "./protocol";

// ---------------------------------------------------------------- load

function toWireTask(task: Task): WireRow {
  const row: WireRow = {
    id: task.id,
    name: task.name,
    startDate: task.startDate,
    endDate: task.endDate,
    duration: task.duration,
    durationUnit: task.durationUnit,
    percentDone: task.percentDone,
    constraintType: task.constraintType,
    constraintDate: task.constraintDate,
    manuallyScheduled: task.manuallyScheduled,
    expanded: task.expanded,
    amount: task.amountCents === null ? null : task.amountCents / 100,
    invoiceStatus: task.invoiceStatus,
    paymentGate: task.paymentGate,
  };
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));
}

export function loadProject(db: Db, projectId: number): LoadResponse | null {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return null;

  const taskRows = db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.orderIndex), asc(tasks.id))
    .all();

  const byParent = new Map<number | null, Task[]>();
  for (const task of taskRows) {
    const siblings = byParent.get(task.parentId) ?? [];
    siblings.push(task);
    byParent.set(task.parentId, siblings);
  }
  const buildTree = (parentId: number | null): WireRow[] =>
    (byParent.get(parentId) ?? []).map((task) => {
      const children = buildTree(task.id);
      return children.length ? { ...toWireTask(task), children } : toWireTask(task);
    });

  const dependencyRows = db
    .select()
    .from(dependencies)
    .where(eq(dependencies.projectId, projectId))
    .all()
    .map((d) => ({
      id: d.id,
      fromTask: d.fromTaskId,
      toTask: d.toTaskId,
      type: d.type,
      lag: d.lag,
      lagUnit: d.lagUnit,
    }));

  return {
    success: true,
    project: { startDate: project.startDate },
    tasks: { rows: buildTree(null) },
    dependencies: { rows: dependencyRows },
  };
}

// ---------------------------------------------------------------- sync

const asNullableString = (v: unknown) => (v === null || v === undefined ? null : String(v));
const asNullableNumber = (v: unknown) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** Maps whitelisted Bryntum task fields to DB columns; unknown engine fields are ignored. */
function taskValues(row: WireRow): Partial<NewTask> {
  const values: Partial<NewTask> = {};
  const has = (key: string) => key in row;

  if (has("name")) values.name = String(row.name ?? "");
  if (has("startDate")) values.startDate = asNullableString(row.startDate);
  if (has("endDate")) values.endDate = asNullableString(row.endDate);
  if (has("duration")) values.duration = asNullableNumber(row.duration);
  if (has("durationUnit") && row.durationUnit) values.durationUnit = String(row.durationUnit);
  if (has("percentDone")) values.percentDone = asNullableNumber(row.percentDone) ?? 0;
  if (has("constraintType")) values.constraintType = asNullableString(row.constraintType);
  if (has("constraintDate")) values.constraintDate = asNullableString(row.constraintDate);
  if (has("manuallyScheduled")) values.manuallyScheduled = Boolean(row.manuallyScheduled);
  if (has("expanded")) values.expanded = Boolean(row.expanded);
  if (has("parentIndex")) values.orderIndex = asNullableNumber(row.parentIndex) ?? 0;
  if (has("invoiceStatus") && row.invoiceStatus) values.invoiceStatus = String(row.invoiceStatus);
  if (has("paymentGate")) values.paymentGate = Boolean(row.paymentGate);
  if (has("amount")) {
    const amount = asNullableNumber(row.amount);
    values.amountCents = amount === null ? null : Math.round(amount * 100);
  }
  return values;
}

/** Resolves a wire id (real numeric id or client phantom id) to a DB id. */
type IdResolver = (wireId: unknown) => number | null | undefined;

function makeResolver(db: DbLike, projectId: number, phantoms: Map<string, number>): IdResolver {
  return (wireId) => {
    if (wireId === null || wireId === undefined || wireId === "") return null;
    if (phantoms.has(String(wireId))) return phantoms.get(String(wireId));
    const id = Number(wireId);
    if (!Number.isInteger(id)) return undefined;
    const owned = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.projectId, projectId)))
      .get();
    return owned ? id : undefined;
  };
}

function syncTasks(
  db: DbLike,
  projectId: number,
  changes: NonNullable<SyncRequest["tasks"]>,
  phantoms: Map<string, number>,
  resolve: IdResolver,
): StoreResponse {
  const responseRows: WireRow[] = [];

  // Added: insert parents before children (a child's parentId may be a phantom id
  // of another record added in the same request).
  let pending = [...(changes.added ?? [])];
  while (pending.length) {
    const pendingPhantoms = new Set(pending.map((row) => String(row[PHANTOM_ID])));
    const ready = pending.filter((row) => !pendingPhantoms.has(String(row.parentId)));
    if (!ready.length) throw new Error("Circular parent references in added tasks");

    for (const row of ready) {
      const parentId = resolve(row.parentId) ?? null;
      const { id } = db
        .insert(tasks)
        .values({ name: "New task", ...taskValues(row), projectId, parentId })
        .returning({ id: tasks.id })
        .get();
      phantoms.set(String(row[PHANTOM_ID]), id);
      responseRows.push({ [PHANTOM_ID]: row[PHANTOM_ID], id });
    }
    pending = pending.filter((row) => !ready.includes(row));
  }

  for (const row of changes.updated ?? []) {
    const id = resolve(row.id);
    if (!id) continue;
    const values = taskValues(row);
    if ("parentId" in row) {
      const parentId = resolve(row.parentId);
      if (parentId !== undefined) values.parentId = parentId;
    }
    if (Object.keys(values).length) {
      db.update(tasks).set(values).where(eq(tasks.id, id)).run();
    }
    responseRows.push({ id });
  }

  return { rows: responseRows };
}

function dependencyEndpoints(row: WireRow, resolve: IdResolver) {
  const from = row.fromTask ?? row.fromEvent ?? row.from;
  const to = row.toTask ?? row.toEvent ?? row.to;
  return {
    from: from === undefined ? undefined : resolve(from),
    to: to === undefined ? undefined : resolve(to),
  };
}

function dependencyValues(row: WireRow) {
  const values: { type?: number; lag?: number; lagUnit?: string } = {};
  if ("type" in row && asNullableNumber(row.type) !== null) values.type = Number(row.type);
  if ("lag" in row) values.lag = asNullableNumber(row.lag) ?? 0;
  if ("lagUnit" in row && row.lagUnit) values.lagUnit = String(row.lagUnit);
  return values;
}

function syncDependencies(
  db: DbLike,
  projectId: number,
  changes: NonNullable<SyncRequest["dependencies"]>,
  resolve: IdResolver,
): StoreResponse {
  const responseRows: WireRow[] = [];

  for (const row of changes.added ?? []) {
    const { from, to } = dependencyEndpoints(row, resolve);
    if (!from || !to) continue;
    const { id } = db
      .insert(dependencies)
      .values({ ...dependencyValues(row), projectId, fromTaskId: from, toTaskId: to })
      .returning({ id: dependencies.id })
      .get();
    responseRows.push({ [PHANTOM_ID]: row[PHANTOM_ID], id });
  }

  for (const row of changes.updated ?? []) {
    const id = Number(row.id);
    const owned = db
      .select({ id: dependencies.id })
      .from(dependencies)
      .where(and(eq(dependencies.id, id), eq(dependencies.projectId, projectId)))
      .get();
    if (!owned) continue;
    const { from, to } = dependencyEndpoints(row, resolve);
    const values = {
      ...dependencyValues(row),
      ...(from ? { fromTaskId: from } : {}),
      ...(to ? { toTaskId: to } : {}),
    };
    if (Object.keys(values).length) {
      db.update(dependencies).set(values).where(eq(dependencies.id, id)).run();
    }
    responseRows.push({ id });
  }

  return { rows: responseRows };
}

function removeRows(
  db: DbLike,
  table: typeof tasks | typeof dependencies,
  projectId: number,
  removed: WireRow[] | undefined,
) {
  const ids = (removed ?? []).map((row) => Number(row.id)).filter(Number.isInteger);
  if (!ids.length) return [];
  db.delete(table)
    .where(and(inArray(table.id, ids), eq(table.projectId, projectId)))
    .run();
  // Acknowledge every id that is now gone — including rows already removed by FK
  // cascades — but never ids still owned by another project.
  const remaining = new Set(
    db.select({ id: table.id }).from(table).where(inArray(table.id, ids)).all().map((r) => r.id),
  );
  return ids.filter((id) => !remaining.has(id)).map((id) => ({ id }));
}

export function syncProject(db: Db, projectId: number, request: SyncRequest): SyncResponse {
  return db.transaction((tx) => {
    const phantoms = new Map<string, number>();
    const resolve = makeResolver(tx, projectId, phantoms);
    const response: SyncResponse = { success: true, requestId: request.requestId };

    const taskResponse: StoreResponse = request.tasks
      ? syncTasks(tx, projectId, request.tasks, phantoms, resolve)
      : {};
    const dependencyResponse: StoreResponse = request.dependencies
      ? syncDependencies(tx, projectId, request.dependencies, resolve)
      : {};

    const removedDependencies = removeRows(tx, dependencies, projectId, request.dependencies?.removed);
    const removedTasks = removeRows(tx, tasks, projectId, request.tasks?.removed);
    if (removedDependencies.length) dependencyResponse.removed = removedDependencies;
    if (removedTasks.length) taskResponse.removed = removedTasks;

    if (taskResponse.rows?.length || taskResponse.removed?.length) response.tasks = taskResponse;
    if (dependencyResponse.rows?.length || dependencyResponse.removed?.length) {
      response.dependencies = dependencyResponse;
    }
    return response;
  });
}
