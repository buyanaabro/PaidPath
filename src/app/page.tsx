import { asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

// Temporary entry point until the landing page (Phase 7): open the first project.
export default async function Home() {
  await connection();
  const first = getDb()
    .select({ id: projects.id })
    .from(projects)
    .orderBy(asc(projects.id))
    .limit(1)
    .get();
  if (!first) notFound();
  redirect(`/projects/${first.id}`);
}
