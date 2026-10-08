import {
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString())
    .$onUpdateFn(() => new Date().toISOString()),
};

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  currency: text("currency").notNull().default("USD"),
  budgetCents: integer("budget_cents").notNull(),
  briefText: text("brief_text"),
  // YYYY-MM-DD
  startDate: text("start_date").notNull(),
  status: text("status", { enum: ["draft", "active"] })
    .notNull()
    .default("active"),
  ...timestamps,
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: integer("parent_id").references((): AnySQLiteColumn => tasks.id, {
    onDelete: "cascade",
  }),
  orderIndex: integer("order_index").notNull().default(0),
  name: text("name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  duration: real("duration"),
  durationUnit: text("duration_unit").notNull().default("day"),
  percentDone: real("percent_done").notNull().default(0),
  constraintType: text("constraint_type"),
  constraintDate: text("constraint_date"),
  manuallyScheduled: integer("manually_scheduled", { mode: "boolean" })
    .notNull()
    .default(false),
  expanded: integer("expanded", { mode: "boolean" }).notNull().default(true),
  amountCents: integer("amount_cents"),
  invoiceStatus: text("invoice_status").notNull().default("none"),
  paymentGate: integer("payment_gate", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const dependencies = sqliteTable("dependencies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  fromTaskId: integer("from_task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  toTaskId: integer("to_task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  // Bryntum dependency type: 2 = finish-to-start
  type: integer("type").notNull().default(2),
  lag: real("lag").notNull().default(0),
  lagUnit: text("lag_unit").notNull().default("day"),
});

export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Dependency = typeof dependencies.$inferSelect;
