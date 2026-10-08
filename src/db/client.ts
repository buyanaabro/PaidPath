import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Db | Tx;

/** Opens a database and applies all migrations. Use ":memory:" in tests. */
export function createDb(path = ":memory:"): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return db;
}

const cache = globalThis as typeof globalThis & { __paidpathDb?: Db };

/** App-wide singleton (cached on globalThis so dev hot reloads reuse it). */
export function getDb(): Db {
  if (!cache.__paidpathDb) {
    const db = createDb(process.env.DATABASE_PATH || "./data/paidpath.db");
    seedIfEmpty(db);
    cache.__paidpathDb = db;
  }
  return cache.__paidpathDb;
}
