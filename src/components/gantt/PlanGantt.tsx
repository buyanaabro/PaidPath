"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import "./paidpath-gantt.css";

import { StringHelper, type DomClassList, type Model, type TaskModel } from "@bryntum/gantt";
import {
  BryntumGantt,
  BryntumGanttProjectModel,
  type BryntumGanttProps,
} from "@bryntum/gantt-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { InvoiceAction, TaskInvoiceStatus } from "@/components/invoices/useInvoices";
import { PaidTaskModel } from "./PaidTaskModel";
import type { SaveStatus } from "./save-status";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const STATUS_LABEL: Record<string, string> = {
  none: "Not invoiced",
  sent: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
};

type Options = {
  canInvoice: boolean;
  onInvoiceAction?: (action: InvoiceAction, taskId: number, name: string) => void;
};

const isPricedMilestone = (task: PaidTaskModel) => task.isMilestone && Boolean(task.amount);
const canSend = (task: PaidTaskModel) =>
  isPricedMilestone(task) && (task.invoiceStatus === "none" || task.invoiceStatus === "cancelled");

const actionButton = (action: InvoiceAction, label: string, primary = false) =>
  `<button type="button" class="pp-action${primary ? " pp-action-primary" : ""}" data-pp-action="${action}">${label}</button>`;

function createGanttProps(options: RefObject<Options>): BryntumGanttProps {
  const act = (action: InvoiceAction, task: TaskModel) =>
    options.current.onInvoiceAction?.(action, Number(task.id), task.name);

  return {
    viewPreset: "weekAndDayLetter",
    barMargin: 8,
    subGridConfigs: { locked: { width: 560 } },
    columns: [
      { type: "name", field: "name", width: 250 },
      {
        text: "Invoice",
        field: "amount",
        width: 300,
        htmlEncode: false,
        renderer: ({ record }: { record: Model }) => {
          const task = record as PaidTaskModel;
          if (!task.amount) return "";
          const status = task.invoiceStatus;
          const pill = `<span class="pp-pill pp-pill-${StringHelper.encodeHtml(status)}">${STATUS_LABEL[status] ?? StringHelper.encodeHtml(status)}</span>`;
          const action = !options.current.canInvoice
            ? ""
            : canSend(task)
              ? actionButton("send", "Send invoice", true)
              : status === "sent"
                ? actionButton("remind", "Remind")
                : "";
          return `<div class="pp-invoice-cell"><span class="pp-amount">${money.format(task.amount)}</span>${pill}${action}</div>`;
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
    taskMenuFeature: {
      items: {
        ppSendInvoice: {
          text: "Send invoice via PayPal",
          icon: "fa fa-file-invoice-dollar",
          separator: true,
          weight: 900,
          onItem: ({ taskRecord }: { taskRecord: TaskModel }) => act("send", taskRecord),
        },
        ppRemind: {
          text: "Send payment reminder",
          icon: "fa fa-bell",
          weight: 901,
          onItem: ({ taskRecord }: { taskRecord: TaskModel }) => act("remind", taskRecord),
        },
        ppRecordPayment: {
          text: "Record payment (sandbox demo)",
          icon: "fa fa-circle-check",
          weight: 902,
          onItem: ({ taskRecord }: { taskRecord: TaskModel }) => act("record-payment", taskRecord),
        },
        ppPayPage: {
          text: "Open client pay page",
          icon: "fa fa-arrow-up-right-from-square",
          weight: 903,
          onItem: ({ taskRecord }: { taskRecord: TaskModel }) => act("pay-page", taskRecord),
        },
      },
      processItems: ({ taskRecord, items }: { taskRecord: TaskModel; items: Record<string, unknown> }) => {
        const task = taskRecord as PaidTaskModel;
        const allowed = options.current.canInvoice && isPricedMilestone(task);
        if (!allowed || !canSend(task)) items.ppSendInvoice = false;
        if (!allowed || task.invoiceStatus !== "sent") {
          items.ppRemind = false;
          items.ppRecordPayment = false;
        }
        if (!allowed || task.invoiceStatus === "none") items.ppPayPage = false;
      },
    },
    onCellClick: ({ record, event }) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-pp-action]");
      if (button) act(button.dataset.ppAction as InvoiceAction, record as TaskModel);
    },
    taskRenderer: ({ taskRecord, renderData }) => {
      const task = taskRecord as PaidTaskModel;
      if (isPricedMilestone(task) && typeof renderData.wrapperCls !== "string") {
        (renderData.wrapperCls as DomClassList).add(`pp-invoice-${task.invoiceStatus}`);
      }
      return task.isLeaf && !task.isMilestone ? StringHelper.encodeHtml(task.name) : "";
    },
  };
}

type Props = Options & {
  projectId: number;
  onSaveStatus?: (status: SaveStatus) => void;
  /** Server-owned milestone fields mirrored from PayPal invoices. */
  taskStatuses?: TaskInvoiceStatus[];
  /** Scrolls to and selects this task when it changes. */
  focusTaskId?: { id: number } | null;
};

export default function PlanGantt({
  projectId,
  onSaveStatus,
  taskStatuses = [],
  focusTaskId,
  canInvoice,
  onInvoiceAction,
}: Props) {
  const project = useRef<BryntumGanttProjectModel>(null);
  const gantt = useRef<BryntumGantt>(null);
  const options = useRef<Options>({ canInvoice, onInvoiceAction });
  const statuses = useRef(taskStatuses);
  // Bryntum configs are built once; the ref is only read inside its event callbacks.
  // eslint-disable-next-line react-hooks/refs
  const [ganttProps] = useState(() => createGanttProps(options));
  const url = `/api/projects/${projectId}/gantt`;

  useEffect(() => {
    options.current = { canInvoice, onInvoiceAction };
    gantt.current?.instance?.refreshRows();
  }, [canInvoice, onInvoiceAction]);

  const applyStatuses = () => {
    const store = project.current?.instance?.taskStore;
    if (!store) return;
    for (const { taskId, invoiceStatus, percentDone } of statuses.current) {
      const task = store.getById(taskId) as PaidTaskModel | undefined;
      if (task && (task.invoiceStatus !== invoiceStatus || task.percentDone !== percentDone)) {
        task.set({ invoiceStatus, percentDone });
      }
    }
  };

  useEffect(() => {
    statuses.current = taskStatuses;
    applyStatuses();
  }, [taskStatuses]);

  useEffect(() => {
    const instance = gantt.current?.instance;
    const task = focusTaskId && project.current?.instance?.taskStore.getById(focusTaskId.id);
    if (!instance || !task) return;
    instance.selectRow({ record: task });
    void instance.scrollTaskIntoView(task as TaskModel, { highlight: true, animate: true });
  }, [focusTaskId]);

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
        onLoad={applyStatuses}
        onBeforeSync={() => onSaveStatus?.({ state: "saving" })}
        onSync={() => onSaveStatus?.({ state: "saved" })}
        onSyncFail={() =>
          onSaveStatus?.({ state: "error", message: "Save failed", retry: retry("sync") })
        }
        onLoadFail={() =>
          onSaveStatus?.({ state: "error", message: "Couldn't load plan", retry: retry("load") })
        }
      />
      <BryntumGantt ref={gantt} {...ganttProps} project={project} />
    </>
  );
}
