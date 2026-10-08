import Link from "next/link";
import { connection } from "next/server";
import AppHeader from "@/components/AppHeader";
import { getDb } from "@/db/client";
import { formatDate, formatMoney } from "@/lib/format";
import { listProjects } from "@/server/projects";

export const metadata = { title: "Projects — PaidPath" };

export default async function ProjectsPage() {
  await connection();
  const projects = listProjects(getDb());

  return (
    <div className="min-h-screen bg-neutral-50">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-neutral-600">
              Every milestone is a PayPal invoice. Unpaid invoices hold up the work behind them.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            New project
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="font-medium">No projects yet</p>
            <p className="mt-1 text-sm text-neutral-600">
              Paste a client brief and the AI architect drafts a priced plan for you.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{project.name}</p>
                    <p className="text-sm text-neutral-600">
                      {project.clientName} · starts {formatDate(project.startDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">
                      {formatMoney(project.totalCents)}
                    </span>
                    <StatusBadge status={project.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: "draft" | "active" }) {
  return status === "draft" ? (
    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">
      AI draft
    </span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
      Active
    </span>
  );
}
