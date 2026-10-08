import { eq, sum } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import ProjectWorkspace from "@/components/workspace/ProjectWorkspace";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { formatMoney } from "@/lib/format";
import { isSimulated, projectToday } from "@/server/clock";
import { invoicesSnapshot } from "@/server/invoicing/http";
import { getProject } from "@/server/projects";

export default async function ProjectPage({ params }: PageProps<"/projects/[projectId]">) {
  await connection();
  const id = Number((await params).projectId);
  const db = getDb();
  const project = Number.isInteger(id) ? getProject(db, id) : undefined;
  if (!project) notFound();

  const total = db
    .select({ cents: sum(tasks.amountCents) })
    .from(tasks)
    .where(eq(tasks.projectId, id))
    .get();

  return (
    <ProjectWorkspace
      project={{
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        status: project.status,
        total: formatMoney(Number(total?.cents ?? 0), project.currency),
        currency: project.currency,
        paymentTermsDays: project.paymentTermsDays,
      }}
      initialClock={{ today: projectToday(project), simulated: isSimulated(project) }}
      initialInvoices={invoicesSnapshot(id)}
    />
  );
}
