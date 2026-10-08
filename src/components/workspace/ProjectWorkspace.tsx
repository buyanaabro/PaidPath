"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import GanttClient from "@/components/gantt/GanttClient";
import { SaveStatusPill, type SaveStatus } from "@/components/gantt/save-status";
import PlanDraftBanner from "./PlanDraftBanner";

type Props = {
  project: {
    id: number;
    name: string;
    clientName: string;
    status: "draft" | "active";
    total: string;
  };
};

export default function ProjectWorkspace({ project }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  // Bumped after the AI replaces the plan, remounting the Gantt so it reloads.
  const [planVersion, setPlanVersion] = useState(0);

  return (
    <main className="flex h-screen flex-col">
      <AppHeader>
        <SaveStatusPill status={saveStatus} />
      </AppHeader>
      <div className="flex items-end justify-between gap-4 border-b border-neutral-200 px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-neutral-500">Client: {project.clientName}</p>
        </div>
        <p className="text-sm text-neutral-600">
          Contract value <span className="font-semibold tabular-nums text-neutral-900">{project.total}</span>
        </p>
      </div>
      {project.status === "draft" && (
        <PlanDraftBanner
          projectId={project.id}
          onRegenerated={() => setPlanVersion((v) => v + 1)}
        />
      )}
      <section className="min-h-0 flex-1">
        <GanttClient key={planVersion} projectId={project.id} onSaveStatus={setSaveStatus} />
      </section>
    </main>
  );
}
