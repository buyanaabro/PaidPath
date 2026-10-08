// Seeds the demo project. Usage: npm run db:seed [-- --reset]
import { loadEnvConfig } from "@next/env";
import { createDb } from "../src/db/client";
import { resetAndSeed, seedIfEmpty } from "../src/db/seed";

loadEnvConfig(process.cwd());

const db = createDb(process.env.DATABASE_PATH || "./data/paidpath.db");
if (process.argv.includes("--reset")) {
  const id = resetAndSeed(db);
  console.log(`Database reset; demo project #${id} seeded.`);
} else {
  seedIfEmpty(db);
  console.log("Database ready (seeded if it was empty).");
}
