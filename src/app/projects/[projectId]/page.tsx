import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ProjectWorkspace from "@/components/workspace/ProjectWorkspace";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";

export default async function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  await connection();
  const id = Number((await params).projectId);
  const project = Number.isInteger(id)
    ? getDb().select().from(projects).where(eq(projects.id, id)).get()
    : undefined;
  if (!project) notFound();

  return (
    <ProjectWorkspace
      project={{ id: project.id, name: project.name, clientName: project.clientName }}
    />
  );
}
