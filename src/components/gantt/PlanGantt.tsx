"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";

import { StringHelper, type Model } from "@bryntum/gantt";
import {
  BryntumGantt,
  BryntumGanttProjectModel,
  type BryntumGanttProps,
} from "@bryntum/gantt-react";
import { useRef } from "react";
import { PaidTaskModel } from "./PaidTaskModel";
import type { SaveStatus } from "./save-status";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const ganttProps: BryntumGanttProps = {
  viewPreset: "weekAndDayLetter",
  barMargin: 8,
  columns: [
    { type: "name", field: "name", width: 280 },
    {
      text: "Invoice",
      field: "amount",
      width: 140,
      renderer: ({ record }: { record: Model }) => {
        const task = record as PaidTaskModel;
        if (!task.amount) return "";
        const status = task.invoiceStatus === "none" ? "" : ` · ${task.invoiceStatus}`;
        return StringHelper.encodeHtml(`${money.format(task.amount)}${status}`);
      },
    },
  ],
  labelsFeature: {
    after: {
      renderer: ({ taskRecord }) => {
        const task = taskRecord as PaidTaskModel;
        return task.isMilestone && task.amount ? money.format(task.amount) : "";
      },
    },
  },
  taskRenderer: ({ taskRecord }) =>
    taskRecord.isLeaf && !taskRecord.isMilestone
      ? StringHelper.encodeHtml(taskRecord.name)
      : "",
};

type Props = {
  projectId: number;
  onSaveStatus?: (status: SaveStatus) => void;
};

export default function PlanGantt({ projectId, onSaveStatus }: Props) {
  const project = useRef<BryntumGanttProjectModel>(null);
  const url = `/api/projects/${projectId}/gantt`;
  const retry = (action: "load" | "sync") => () => {
    void project.current?.instance?.[action]();
  };

  return (
    <>
      <BryntumGanttProjectModel
        ref={project}
        taskModelClass={PaidTaskModel}
        loadUrl={url}
        syncUrl={url}
        autoLoad
        autoSync
        validateResponse={process.env.NODE_ENV !== "production"}
        onBeforeSync={() => onSaveStatus?.({ state: "saving" })}
        onSync={() => onSaveStatus?.({ state: "saved" })}
        onSyncFail={() =>
          onSaveStatus?.({ state: "error", message: "Save failed", retry: retry("sync") })
        }
        onLoadFail={() =>
          onSaveStatus?.({ state: "error", message: "Couldn't load plan", retry: retry("load") })
        }
      />
      <BryntumGantt {...ganttProps} project={project} />
    </>
  );
}
