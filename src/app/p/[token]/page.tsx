import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import PortalView from "@/components/portal/PortalView";
import { getDb } from "@/db/client";
import { projectByToken, recordPortalVisit } from "@/server/portal";
import { portalSnapshot } from "@/server/portal-snapshot";

// Capability links must not be indexed or previewed with project data.
export const metadata: Metadata = { title: "Project timeline", robots: { index: false, follow: false } };

export default async function ClientPortalPage({ params }: PageProps<"/p/[token]">) {
  await connection();
  const { token } = await params;
  const db = getDb();
  const project = projectByToken(db, token);
  if (!project) notFound();
  recordPortalVisit(db, project.id);
  return <PortalView token={token} initial={portalSnapshot(db, project)} />;
}
