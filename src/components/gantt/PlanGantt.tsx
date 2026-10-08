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
import { demoDependencies, demoProjectStart, demoTasks } from "@/lib/demo-plan";
import { PaidTaskModel } from "./PaidTaskModel";

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
        return task.amount
          ? StringHelper.encodeHtml(
              `${money.format(task.amount)} · ${task.invoiceStatus}`,
            )
          : "";
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

export default function PlanGantt() {
  const project = useRef<BryntumGanttProjectModel>(null);

  return (
    <>
      <BryntumGanttProjectModel
        ref={project}
        taskModelClass={PaidTaskModel}
        startDate={demoProjectStart}
        tasks={demoTasks}
        dependencies={demoDependencies}
      />
      <BryntumGantt {...ganttProps} project={project} />
    </>
  );
}
