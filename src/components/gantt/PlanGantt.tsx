"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import "./paidpath-gantt.css";

import {
  GooglePlugin,
  LocaleHelper,
  StringHelper,
  Toast,
  type DomClassList,
  type Gantt,
  type Locale,
  type Model,
  type ProjectModel,
  type Store,
  type TaskModel,
} from "@bryntum/gantt";
import {
  BryntumGantt,
  BryntumGanttProjectModel,
  type BryntumGanttProps,
} from "@bryntum/gantt-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createCopilotTools } from "@/components/copilot/tools";
import type { InvoiceAction, InvoicesSnapshot, TaskInvoiceStatus } from "@/components/invoices/useInvoices";
import type { ClockState } from "@/components/workspace/DemoClock";
import type { MilestoneCash } from "@/lib/cashflow";
import { LAST_RESORT_MODEL } from "@/lib/models";
import {
  addDays,
  expectedPayment,
  localIsoDate,
  toIsoDate,
  type GateInvoice,
  type IsoDate,
} from "@/lib/gates";
import { PaidTaskModel } from "./PaidTaskModel";
import {
  applyPaymentGates,
  baselineFinish,
  captureBaselineIfMissing,
  describeHold,
  gateInputFor,
  holdingGate,
  type GateContext,
} from "./payment-gates";
import type { SaveStatus } from "./save-status";

// The 7.3.7 trial bundle's built-in English locale lacks these AI chat strings
// (the undo icon tooltip rendered as "L{ChatPanel.undoTooltip}"). Merged into "En".
LocaleHelper.publishLocale("En", {
  ChatPanel: { undoTooltip: "Undo data changes", redoTooltip: "Redo data changes" },
} as unknown as Locale);

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const STATUS_LABEL: Record<string, string> = {
  none: "Not invoiced",
  sent: "Awaiting payment",
  overdue: "Overdue",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Money/clock inputs for the payment gates (from the workspace). */
export type GateState = {
  today: IsoDate;
  simulated: boolean;
  termsDays: number;
  invoices: (GateInvoice & { taskId: number | null; overdue: boolean })[];
};

export type ScheduleInfo = {
  finish: IsoDate | null;
  baselineFinish: IsoDate | null;
  cash: MilestoneCash[];
};

/** Planned / expected / received payment dates for every priced milestone. */
function milestoneCash(project: ProjectModel, gate: GateContext): MilestoneCash[] {
  const milestones = project.taskStore.query(
    (t: Model) => (t as PaidTaskModel).isMilestone && Boolean((t as PaidTaskModel).amount),
  ) as PaidTaskModel[];
  return milestones.map((task) => {
    const invoice = gate.invoicesByTask.get(Number(task.id));
    const baseline = (task.baselines as Store | undefined)?.first as { endDate?: Date } | undefined;
    const received = invoice?.status === "paid" && invoice.paidAt ? toIsoDate(invoice.paidAt) : null;
    return {
      name: task.name.replace(/^Milestone:\s*/i, ""),
      amountCents: Math.round((task.amount ?? 0) * 100),
      // Baseline payment date = baseline milestone date + terms (like-for-like with "expected").
      planned: baseline?.endDate ? addDays(localIsoDate(baseline.endDate), gate.termsDays) : null,
      expected: received || !task.endDate ? null : expectedPayment(gateInputFor(task, gate)).date,
      received,
    };
  });
}

type CopilotUpdate = (snapshot: InvoicesSnapshot, clock?: ClockState) => void;

type Options = {
  projectId: number;
  client: { name: string; email: string };
  getProject: () => ProjectModel | undefined;
  onCopilotUpdate?: CopilotUpdate;
  canInvoice: boolean;
  onInvoiceAction?: (action: InvoiceAction, taskId: number, name: string) => void;
  gate: GateContext;
  overdueTaskIds: Set<number>;
};

const isPricedMilestone = (task: PaidTaskModel) => task.isMilestone && Boolean(task.amount);
const canSend = (task: PaidTaskModel) =>
  isPricedMilestone(task) && (task.invoiceStatus === "none" || task.invoiceStatus === "cancelled");
const displayStatus = (task: PaidTaskModel, options: Options) =>
  task.invoiceStatus === "sent" && options.overdueTaskIds.has(Number(task.id)) ? "overdue" : task.invoiceStatus;

/** A priced milestone contributes its amount in the interval containing `when`. */
const actionButton = (action: InvoiceAction, label: string, primary = false) =>
  `<button type="button" class="pp-action${primary ? " pp-action-primary" : ""}" data-pp-action="${action}">${label}</button>`;

const toGateContext = (gate: GateState): GateContext => ({
  today: gate.today,
  termsDays: gate.termsDays,
  invoicesByTask: new Map(
    gate.invoices
      .filter((invoice) => invoice.taskId !== null && invoice.status !== "cancelled")
      .map((invoice) => [invoice.taskId!, invoice]),
  ),
});

function createGanttProps(options: RefObject<Options>): BryntumGanttProps {
  const act = (action: InvoiceAction, task: TaskModel) =>
    options.current.onInvoiceAction?.(action, Number(task.id), task.name);
  const toggle =
    (feature: "criticalPaths" | "baselines") =>
    ({ source, checked }: { source: { up: (type: string) => unknown }; checked: boolean }) => {
      const gantt = source.up("gantt") as Gantt | null;
      if (gantt) gantt.features[feature].disabled = !checked;
    };

  return {
    viewPreset: "weekAndDayLetter",
    barMargin: 8,
    subGridConfigs: { locked: { width: 560 } },
    tbar: [
      { type: "slidetoggle", text: "Critical path", checked: false, onChange: toggle("criticalPaths") },
      { type: "slidetoggle", text: "Baseline", checked: true, onChange: toggle("baselines") },
      "->",
      {
        type: "buttongroup",
        items: [
          { icon: "fa fa-search-minus", tooltip: "Zoom out", onAction: ({ source }: { source: { up: (t: string) => Gantt } }) => source.up("gantt").zoomOut() },
          { icon: "fa fa-search-plus", tooltip: "Zoom in", onAction: ({ source }: { source: { up: (t: string) => Gantt } }) => source.up("gantt").zoomIn() },
          { icon: "fa fa-compress-arrows-alt", tooltip: "Fit plan", onAction: ({ source }: { source: { up: (t: string) => Gantt } }) => source.up("gantt").zoomToFit({ leftMargin: 40, rightMargin: 40 }) },
        ],
      },
    ],
    aiFeature: {
      promptUrl: `/api/ai/prompt?projectId=${options.current.projectId}`,
      apiPlugin: GooglePlugin,
      // The server picks the real model by free-tier quota; this one is always allowed.
      model: LAST_RESORT_MODEL,
      // Planning costs extra round-trips per question (free-tier budget).
      planning: false,
      mentions: false,
      // A prompt includes the user's confirmation dialogs; the default 60s is too short.
      timeout: 180_000,
      requireConfirmationOnUpdates: true,
      requireConfirmationOnRemovals: true,
      requireConfirmationOnAdds: true,
      debugMode: process.env.NODE_ENV !== "production",
      chatButton: {
        tooltip: "PaidPath Copilot",
        chatPanel: {
          title: "PaidPath Copilot",
          width: "28em",
          drawer: { autoClose: false },
          intro: {
            html: "<b>Ask about money and schedule</b> — I can see invoices, payment holds and the demo clock, run what-ifs, and send invoices or reminders after you confirm.",
          },
          examplePrompts: [
            "When do I get paid, and what if Aurora pays a week late?",
            "Chase the overdue invoice",
            "Fast-forward two weeks — what's at risk?",
            "Make High-fidelity mockups take 2 days longer",
          ],
        },
      },
      tools: createCopilotTools(() => {
        const current = options.current;
        return {
          projectId: current.projectId,
          canAct: current.canInvoice,
          client: current.client,
          termsDays: current.gate.termsDays,
          project: current.getProject(),
          gate: current.gate,
          onSnapshot: (snapshot) => current.onCopilotUpdate?.(snapshot),
          onClock: (clock, snapshot) => current.onCopilotUpdate?.(snapshot, clock),
        };
      }),
    },
    criticalPathsFeature: { disabled: true },
    baselinesFeature: true,
    timeRangesFeature: { showCurrentTimeLine: false },
    indicatorsFeature: {
      items: {
        earlyDates: false,
        lateDates: false,
        constraintDate: false,
        paymentHold: (taskRecord: TaskModel) => {
          const task = taskRecord as PaidTaskModel;
          const gate = task.gateHold ? holdingGate(task, task.project as unknown as ProjectModel) : undefined;
          if (!task.gateHold || !gate) return null;
          const [y, m, d] = task.gateHold.split("-").map(Number);
          return {
            startDate: new Date(y, m - 1, d),
            name: describeHold(gate, options.current.gate),
            iconCls: "fa fa-hand-holding-dollar",
            cls: "pp-hold-indicator",
          };
        },
      },
    },
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
          const status = displayStatus(task, options.current);
          const pill = `<span class="pp-pill pp-pill-${StringHelper.encodeHtml(status)}">${STATUS_LABEL[status] ?? StringHelper.encodeHtml(status)}</span>`;
          const action = !options.current.canInvoice
            ? ""
            : canSend(task)
              ? actionButton("send", "Send invoice", true)
              : task.invoiceStatus === "sent"
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
      const classes = renderData.wrapperCls as DomClassList | string;
      if (typeof classes !== "string") {
        if (isPricedMilestone(task)) classes.add(`pp-invoice-${displayStatus(task, options.current)}`);
        if (task.gateHold) classes.add("pp-gate-held");
      }
      if (!task.isLeaf || task.isMilestone) return "";
      const name = StringHelper.encodeHtml(task.name);
      return task.gateHold ? `<i class="fa fa-lock pp-lock" aria-hidden="true"></i>${name}` : name;
    },
  };
}

/**
 * Resolves once the AI feature's undo transaction (project STM) has closed, so server-owned
 * state (invoice status, payment holds) is never recorded as an undoable AI change —
 * "Undo" must not appear to un-send a PayPal invoice.
 */
function afterAiTransaction(project: ProjectModel) {
  const stm = project.stm;
  if (!stm?.isRecording) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 120_000);
    const detach = stm.on({ recordingStop: done }) as () => void;
    function done() {
      clearTimeout(timer);
      detach();
      resolve();
    }
  });
}

const TODAY_RANGE_ID = "pp-today";

/** Local-only "Today" line at the project's (possibly simulated) date. */
function showToday(project: ProjectModel, today: IsoDate, simulated: boolean) {
  const store = project.timeRangeStore;
  const [y, m, d] = today.split("-").map(Number);
  const values = {
    name: simulated ? "Today (demo clock)" : "Today",
    startDate: new Date(y, m - 1, d),
    duration: 0,
    cls: simulated ? "pp-today pp-today-simulated" : "pp-today",
  };
  const existing = store.getById(TODAY_RANGE_ID);
  if (existing) existing.set(values);
  else store.add({ id: TODAY_RANGE_ID, ...values });
}

type Props = {
  projectId: number;
  canInvoice: boolean;
  onInvoiceAction?: Options["onInvoiceAction"];
  onSaveStatus?: (status: SaveStatus) => void;
  /** Server-owned milestone fields mirrored from PayPal invoices. */
  taskStatuses?: TaskInvoiceStatus[];
  gate: GateState;
  onSchedule?: (info: ScheduleInfo) => void;
  /** Scrolls to and selects this task when it changes. */
  focusTaskId?: { id: number } | null;
  client: { name: string; email: string };
  /** Copilot actions changed invoices (and maybe the clock). */
  onCopilotUpdate?: CopilotUpdate;
};

export default function PlanGantt({
  projectId,
  onSaveStatus,
  taskStatuses = [],
  focusTaskId,
  canInvoice,
  onInvoiceAction,
  gate,
  onSchedule,
  client,
  onCopilotUpdate,
}: Props) {
  const project = useRef<BryntumGanttProjectModel>(null);
  const gantt = useRef<BryntumGantt>(null);
  const getProject = () => project.current?.instance;
  const options = useRef<Options>({
    projectId,
    client,
    getProject,
    onCopilotUpdate,
    canInvoice,
    onInvoiceAction,
    gate: toGateContext(gate),
    overdueTaskIds: new Set(),
  });
  const latest = useRef({ taskStatuses, gate, canInvoice, onSchedule });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loaded = useRef(false);
  // Bryntum configs are built once; the ref is only read inside its event callbacks.
  // eslint-disable-next-line react-hooks/refs
  const [ganttProps] = useState(() => createGanttProps(options));
  const url = `/api/projects/${projectId}/gantt`;

  /** Mirrors invoice state, applies payment gates and reports the schedule — serialized. */
  const reconcile = (announce: boolean) => {
    queue.current = queue.current.then(async () => {
      const instance = project.current?.instance;
      if (!instance || !loaded.current) return;
      await afterAiTransaction(instance);
      const { taskStatuses, gate, canInvoice, onSchedule } = latest.current;

      for (const { taskId, invoiceStatus, percentDone } of taskStatuses) {
        const task = instance.taskStore.getById(taskId) as PaidTaskModel | undefined;
        if (task && (task.invoiceStatus !== invoiceStatus || task.percentDone !== percentDone)) {
          task.set({ invoiceStatus, percentDone });
        }
      }
      showToday(instance, gate.today, gate.simulated);

      const result = await applyPaymentGates(instance, options.current.gate);
      if (canInvoice && captureBaselineIfMissing(instance)) await instance.commitAsync();
      gantt.current?.instance?.refreshRows();
      onSchedule?.({
        finish: result.finishAfter,
        baselineFinish: baselineFinish(instance),
        cash: milestoneCash(instance, options.current.gate),
      });

      if (announce && result.finishBefore && result.finishAfter && result.finishAfter !== result.finishBefore) {
        const delta = Math.round(
          (Date.parse(result.finishAfter) - Date.parse(result.finishBefore)) / 86_400_000,
        );
        const days = `${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"}`;
        Toast.show({
          html:
            delta < 0
              ? `<b>Payment expected sooner → launch pulled in by ${days}</b>`
              : `<b>Waiting on payment → launch pushed out by ${days}</b>`,
          timeout: 4500,
          cls: delta < 0 ? "pp-toast-good" : "pp-toast-bad",
        });
      }
    }).catch((error) => console.error("Applying payment gates failed", error));
  };

  useEffect(() => {
    latest.current = { taskStatuses, gate, canInvoice, onSchedule };
    options.current = {
      projectId,
      client,
      getProject: () => project.current?.instance,
      onCopilotUpdate,
      canInvoice,
      onInvoiceAction,
      gate: toGateContext(gate),
      overdueTaskIds: new Set(
        gate.invoices.filter((i) => i.overdue && i.taskId !== null).map((i) => i.taskId!),
      ),
    };
    reconcile(true);
    // The copilot acts on invoices and the clock, so it only exists for accepted plans.
    const ai = gantt.current?.instance?.features.ai;
    if (ai) {
      ai.disabled = !canInvoice;
      const button = (ai as unknown as { chatButton?: { hidden: boolean } }).chatButton;
      if (button && typeof button === "object") button.hidden = !canInvoice;
    }
  }, [projectId, client, onCopilotUpdate, taskStatuses, gate, canInvoice, onInvoiceAction, onSchedule]);

  useEffect(() => {
    // The demo "Today" line is presentation only — never sync time ranges to the server.
    project.current?.instance?.removeCrudStore("timeRanges");
  }, []);

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
        onLoad={() => {
          loaded.current = true;
          reconcile(false);
        }}
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
