"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import "@/components/gantt/paidpath-gantt.css";

import { StringHelper, Toast, type DomClassList, type ProjectModel, type TaskModel } from "@bryntum/gantt";
import { BryntumGantt, BryntumGanttProjectModel, type BryntumGanttProps } from "@bryntum/gantt-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { PaidTaskModel } from "@/components/gantt/PaidTaskModel";
import { applyPaymentGates, baselineFinish, holdingGate, type GateContext } from "@/components/gantt/payment-gates";
import { simulatePayments } from "@/components/gantt/simulate";
import { showToday } from "@/components/gantt/today-line";
import type { TaskInvoiceStatus } from "@/components/invoices/useInvoices";
import { daysBetween, type IsoDate } from "@/lib/gates";

export type PortalGanttApi = {
  /** Projected launch if the client paid this milestone's invoice today (null if no change). */
  payTodayEffect: (taskId: number) => Promise<{ finishNow: IsoDate | null; finishIfPaidToday: IsoDate | null } | null>;
};

type Props = {
  token: string;
  gate: GateContext;
  simulated: boolean;
  taskStatuses: TaskInvoiceStatus[];
  paidCount: number;
  onReady: (api: PortalGanttApi) => void;
  onSchedule: (info: { finish: IsoDate | null; baselineFinish: IsoDate | null }) => void;
};

const bare = (name: string) => name.replace(/^Milestone:\s*/i, "");

function createProps(gate: RefObject<GateContext>): BryntumGanttProps {
  // Phones get a narrower name column so the timeline stays visible.
  const nameWidth = window.innerWidth < 640 ? 150 : 260;
  return {
    readOnly: true,
    viewPreset: "weekAndDayLetter",
    barMargin: 8,
    subGridConfigs: { locked: { width: nameWidth } },
    columns: [{ type: "name", field: "name", width: nameWidth }],
    taskMenuFeature: false,
    cellMenuFeature: false,
    baselinesFeature: false,
    timeRangesFeature: { showCurrentTimeLine: false },
    indicatorsFeature: {
      items: {
        earlyDates: false,
        lateDates: false,
        constraintDate: false,
        deadlineDate: false,
        paymentHold: (taskRecord: TaskModel) => {
          const task = taskRecord as PaidTaskModel;
          const milestone = task.gateHold ? holdingGate(task, task.project as unknown as ProjectModel) : undefined;
          if (!task.gateHold || !milestone) return null;
          const [y, m, d] = task.gateHold.split("-").map(Number);
          const paid = gate.current.invoicesByTask.get(Number(milestone.id))?.status === "paid";
          return {
            startDate: new Date(y, m - 1, d),
            name: paid
              ? `Started after your “${bare(milestone.name)}” payment`
              : `Starts after the “${bare(milestone.name)}” payment`,
            iconCls: "fa fa-hand-holding-dollar",
            cls: "pp-hold-indicator",
          };
        },
      },
    },
    labelsFeature: false,
    taskRenderer: ({ taskRecord, renderData }) => {
      const task = taskRecord as PaidTaskModel;
      const classes = renderData.wrapperCls as DomClassList | string;
      if (typeof classes !== "string") {
        if (task.isMilestone && task.amount) classes.add(`pp-invoice-${task.invoiceStatus}`);
        if (task.gateHold) classes.add("pp-gate-held");
      }
      if (!task.isLeaf || task.isMilestone) return "";
      const name = StringHelper.encodeHtml(task.name);
      return task.gateHold ? `<i class="fa fa-lock pp-lock" aria-hidden="true"></i>${name}` : name;
    },
  };
}

/** The client's read-only timeline. Payment holds are applied in memory and never saved. */
export default function PortalGantt({ token, gate, simulated, taskStatuses, paidCount, onReady, onSchedule }: Props) {
  const project = useRef<BryntumGanttProjectModel>(null);
  const gantt = useRef<BryntumGantt>(null);
  const gateRef = useRef(gate);
  const loaded = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastPaid = useRef<number | null>(null);
  // Config is built once; the ref is only read inside Bryntum callbacks.
  // eslint-disable-next-line react-hooks/refs
  const [props] = useState(() => createProps(gateRef));
  const latest = useRef({ taskStatuses, simulated, paidCount, onSchedule });

  const reconcile = () => {
    queue.current = queue.current
      .then(async () => {
        const instance = project.current?.instance;
        if (!instance || !loaded.current) return;
        const { taskStatuses, simulated, paidCount, onSchedule } = latest.current;
        for (const { taskId, invoiceStatus } of taskStatuses) {
          const task = instance.taskStore.getById(taskId) as PaidTaskModel | undefined;
          if (task && task.invoiceStatus !== invoiceStatus) task.set({ invoiceStatus });
        }
        showToday(instance, gateRef.current.today, simulated);
        const result = await applyPaymentGates(instance, gateRef.current);
        gantt.current?.instance?.refreshRows();
        onSchedule({ finish: result.finishAfter, baselineFinish: baselineFinish(instance) });
        // A payment just landed: celebrate the launch moving in.
        const previous = lastPaid.current;
        lastPaid.current = paidCount;
        if (previous !== null && paidCount > previous) {
          const moved = result.finishBefore && result.finishAfter ? daysBetween(result.finishAfter, result.finishBefore) : 0;
          Toast.show({
            html:
              moved > 0
                ? `<b>Thank you! Your launch moved ${moved} day${moved === 1 ? "" : "s"} earlier.</b>`
                : "<b>Thank you — payment received.</b>",
            timeout: 6000,
            cls: "pp-toast-good",
          });
        }
      })
      .catch((error) => console.error("Portal schedule update failed", error));
  };

  useEffect(() => {
    gateRef.current = gate;
    latest.current = { taskStatuses, simulated, paidCount, onSchedule };
    reconcile();
  }, [gate, taskStatuses, simulated, paidCount, onSchedule]);

  useEffect(() => {
    project.current?.instance?.removeCrudStore("timeRanges");
    onReady({
      payTodayEffect: async (taskId) => {
        const instance = project.current?.instance;
        if (!instance || !loaded.current) return null;
        const { finishNow, scenarios } = await simulatePayments(instance, gateRef.current, taskId, [gateRef.current.today]);
        return { finishNow, finishIfPaidToday: scenarios[0].finish };
      },
    });
  }, [onReady]);

  return (
    <>
      <BryntumGanttProjectModel
        ref={project}
        taskModelClass={PaidTaskModel}
        loadUrl={`/api/portal/${token}/gantt`}
        autoLoad
        onLoad={() => {
          loaded.current = true;
          reconcile();
        }}
      />
      <BryntumGantt ref={gantt} {...props} project={project} />
    </>
  );
}
