"use client";

import { useState } from "react";
import GanttClient from "@/components/gantt/GanttClient";
import { SaveStatusPill, type SaveStatus } from "@/components/gantt/save-status";

type Props = {
  project: { id: number; name: string; clientName: string };
};

export default function ProjectWorkspace({ project }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            PaidPath
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-neutral-500">Client: {project.clientName}</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusPill status={saveStatus} />
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            PayPal sandbox
          </span>
        </div>
      </header>
      <section className="min-h-0 flex-1">
        <GanttClient projectId={project.id} onSaveStatus={setSaveStatus} />
      </section>
    </main>
  );
}
