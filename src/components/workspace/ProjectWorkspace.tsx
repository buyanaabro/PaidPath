"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ActivityClient from "@/components/activity/ActivityClient";
import { useActivity } from "@/components/activity/useActivity";
import AppHeader from "@/components/AppHeader";
import GanttClient from "@/components/gantt/GanttClient";
import type { GanttApi, GateState, ScheduleInfo } from "@/components/gantt/PlanGantt";
import { SaveStatusPill, type SaveStatus } from "@/components/gantt/save-status";
import CashChart from "@/components/invoices/CashChart";
import LedgerClient from "@/components/invoices/LedgerClient";
import QrDialog from "@/components/invoices/QrDialog";
import SendInvoiceDialog from "@/components/invoices/SendInvoiceDialog";
import {
  useInvoices,
  type InvoiceAction,
  type InvoicesSnapshot,
} from "@/components/invoices/useInvoices";
import Button from "@/components/ui/Button";
import { flashClass, useFlashOnChange } from "@/hooks/useFlashOnChange";
import { discountView } from "@/lib/discount";
import { formatDate, formatMoney } from "@/lib/format";
import { daysBetween } from "@/lib/gates";
import { rubberband } from "@/lib/motion";
import type { ActivityItem } from "@/server/activity";
import type { InvoiceView } from "@/server/invoicing/service";
import ClientViewButton from "./ClientViewButton";
import DemoClock, { type ClockState } from "./DemoClock";
import DemoGuide from "./DemoGuide";
import PlanDraftBanner from "./PlanDraftBanner";

type Props = {
  project: {
    id: number;
    name: string;
    clientName: string;
    clientEmail: string;
    status: "draft" | "active";
    isDemo: boolean;
    total: string;
    currency: string;
    paymentTermsDays: number;
  };
  initialInvoices: InvoicesSnapshot;
  initialClock: ClockState;
  initialActivity: ActivityItem[];
};

const LEDGER_MIN = 140;
const LEDGER_DEFAULT = "clamp(150px, 24vh, 270px)";
type TabKey = "invoices" | "activity";

const earlierIsGood = (prev: string | number, next: string | number) =>
  String(next) < String(prev) ? "good" as const : String(next) > String(prev) ? "bad" as const : "neutral" as const;
const upIsGood = (prev: string | number, next: string | number) =>
  Number(next) > Number(prev) ? "good" as const : Number(next) < Number(prev) ? "bad" as const : "neutral" as const;
const downIsGood = (prev: string | number, next: string | number) =>
  Number(next) < Number(prev) ? "good" as const : Number(next) > Number(prev) ? "bad" as const : "neutral" as const;

export default function ProjectWorkspace({ project, initialInvoices, initialClock, initialActivity }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  // Bumped after the AI replaces the plan, remounting the Gantt so it reloads.
  const [planVersion, setPlanVersion] = useState(0);
  const [focusTask, setFocusTask] = useState<{ id: number } | null>(null);
  const [qrInvoice, setQrInvoice] = useState<InvoiceView | null>(null);
  const [sending, setSending] = useState<{ taskId: number; name: string; amountCents: number; isGate: boolean } | null>(null);
  const [ganttApi, setGanttApi] = useState<GanttApi | null>(null);
  const [ledgerHeight, setLedgerHeight] = useState<number | string>(LEDGER_DEFAULT);
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [snapping, setSnapping] = useState(false);
  const [tab, setTab] = useState<TabKey>("invoices");
  const splitRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    startY: number;
    startH: number;
    raf: number;
    lastY: number;
  } | null>(null);
  const [clock, setClock] = useState(initialClock);
  const [schedule, setSchedule] = useState<ScheduleInfo>({
    finish: null,
    baselineFinish: null,
    cash: [],
  });
  const invoicesApi = useInvoices(project.id, initialInvoices);
  const { invoices, busy, error, replaceSnapshot } = invoicesApi;
  const activity = useActivity(project.id, initialActivity, `${clock.today}|${invoices.map((i) => `${i.id}:${i.status}:${i.reminderCount}`).join(",")}`);
  const client = useMemo(
    () => ({ name: project.clientName, email: project.clientEmail }),
    [project.clientName, project.clientEmail],
  );
  const onCopilotUpdate = useCallback(
    (snapshot: InvoicesSnapshot, nextClock?: ClockState) => {
      replaceSnapshot(snapshot);
      if (nextClock) setClock(nextClock);
    },
    [replaceSnapshot],
  );

  const gate = useMemo<GateState>(
    () => ({
      today: clock.today,
      simulated: clock.simulated,
      termsDays: project.paymentTermsDays,
      invoices: invoices.map((invoice) => ({
        taskId: invoice.taskId,
        status: invoice.status,
        dueAt: invoice.dueAt,
        paidAt: invoice.paidAt,
        overdue: invoice.overdue,
        discount: (() => {
          const view = discountView(invoice, clock.today);
          return view?.state === "active" ? { percent: view.percent, until: view.until } : null;
        })(),
      })),
    }),
    [clock, invoices, project.paymentTermsDays],
  );
  const slip =
    schedule.finish && schedule.baselineFinish ? daysBetween(schedule.baselineFinish, schedule.finish) : null;

  const runAction = useCallback(
    (action: InvoiceAction, invoice: InvoiceView | undefined, taskId: number, name: string) => {
      if (action === "send") {
        // Confirm in the send dialog (with the early-payment discount suggestion).
        const milestone = ganttApi?.milestone(taskId);
        if (!milestone) return void invoicesApi.send(taskId, name);
        return setSending({ taskId, ...milestone });
      }
      if (!invoice) return;
      if (action === "remind") return void invoicesApi.remind(invoice.id);
      if (action === "record-payment") return void invoicesApi.recordPayment(invoice.id);
      if (action === "qr") return setQrInvoice(invoice);
      if (action === "pay-page" && invoice.payUrl) window.open(invoice.payUrl, "_blank", "noopener");
    },
    [invoicesApi, ganttApi],
  );

  const latestInvoiceFor = (taskId: number) =>
    invoices.find((invoice) => invoice.taskId === taskId && invoice.status !== "cancelled");

  const onGanttAction = useCallback(
    (action: InvoiceAction, taskId: number, name: string) => {
      if (invoicesApi.busy) return;
      runAction(action, latestInvoiceFor(taskId), taskId, name);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestInvoiceFor reads `invoices`
    [invoices, invoicesApi.busy, runAction],
  );

  const maxHeight = () => window.innerHeight * 0.7;
  const measuredHeight = () => {
    if (typeof ledgerHeight === "number") return ledgerHeight;
    return panelRef.current?.getBoundingClientRect().height || 220;
  };
  const boundHeight = (h: number, resist: boolean) => {
    const max = maxHeight();
    if (!resist) return Math.min(Math.max(h, LEDGER_MIN), max);
    if (h < LEDGER_MIN) return LEDGER_MIN - rubberband(LEDGER_MIN - h, LEDGER_MIN);
    if (h > max) return max + rubberband(h - max, max);
    return h;
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ledgerOpen) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSnapping(false);
    drag.current = {
      startY: event.clientY,
      startH: measuredHeight(),
      raf: 0,
      lastY: event.clientY,
    };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.lastY = event.clientY;
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      if (!drag.current) return;
      drag.current.raf = 0;
      const delta = drag.current.startY - drag.current.lastY;
      setLedgerHeight(boundHeight(drag.current.startH + delta, true));
    });
  };
  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const delta = state.startY - state.lastY;
    setSnapping(true);
    setLedgerHeight(boundHeight(state.startH + delta, false));
  };

  const totals = invoices.reduce(
    (sum, invoice) => {
      if (invoice.status === "sent") sum.outstanding += invoice.amountCents;
      if (invoice.status === "paid") sum.paid += invoice.paidAmountCents ?? invoice.amountCents;
      return sum;
    },
    { outstanding: 0, paid: 0 },
  );
  const finishFlash = useFlashOnChange(schedule.finish, earlierIsGood);
  const paidFlash = useFlashOnChange(totals.paid, upIsGood);
  const outFlash = useFlashOnChange(totals.outstanding, downIsGood);

  const selectTab = (key: TabKey) => {
    setTab(key);
    setLedgerOpen(true);
    if (key === "activity") activity.markSeen();
  };

  const onTabKey = (event: React.KeyboardEvent, key: TabKey) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next: TabKey = key === "invoices" ? "activity" : "invoices";
    selectTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const panelHeight = ledgerOpen ? ledgerHeight : 0;
  const ariaNow =
    typeof ledgerHeight === "number" ? Math.round(ledgerHeight) : 220;

  return (
    <main className="flex h-screen flex-col">
      <AppHeader>
        <DemoClock
          projectId={project.id}
          clock={clock}
          onChange={(next, snapshot) => {
            setClock(next);
            invoicesApi.replaceSnapshot(snapshot);
          }}
        />
        {project.status === "active" && <ClientViewButton projectId={project.id} />}
        <SaveStatusPill status={saveStatus} />
      </AppHeader>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg text-heading">{project.name}</h1>
          <p className="text-xs text-ink-muted">Client: {project.clientName}</p>
        </div>
        <div className="flex flex-wrap gap-5 text-sm text-ink-muted">
          {schedule.finish && (
            <span data-testid="finish-kpi" className={flashClass(finishFlash)}>
              Projected finish{" "}
              <span className="font-semibold tabular-nums text-ink">{formatDate(schedule.finish)}</span>
              {slip !== null && slip !== 0 && (
                <span className={`ml-1 font-semibold ${slip > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {" "}
                  {slip > 0 ? `+${slip}` : slip} days vs baseline
                </span>
              )}
              {slip === 0 && <span className="ml-1 text-ink-muted"> on baseline</span>}
            </span>
          )}
          <span>
            Contract <span className="font-semibold tabular-nums text-ink">{project.total}</span>
          </span>
          <span className={flashClass(paidFlash)}>
            Paid{" "}
            <span className="font-semibold tabular-nums text-emerald-700">
              {formatMoney(totals.paid, project.currency)}
            </span>
          </span>
          <span className={flashClass(outFlash)}>
            Outstanding{" "}
            <span className="font-semibold tabular-nums text-blue-700">
              {formatMoney(totals.outstanding, project.currency)}
            </span>
          </span>
        </div>
      </div>
      {project.isDemo && (
        <DemoGuide invoices={invoices} actions={activity.items.map((item) => item.action)} />
      )}
      {project.status === "draft" && (
        <PlanDraftBanner
          projectId={project.id}
          onRegenerated={() => setPlanVersion((v) => v + 1)}
        />
      )}

      <section ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <GanttClient
            key={planVersion}
            projectId={project.id}
            onSaveStatus={setSaveStatus}
            canInvoice={project.status === "active"}
            onInvoiceAction={onGanttAction}
            taskStatuses={invoicesApi.taskStatuses}
            gate={gate}
            onSchedule={setSchedule}
            focusTaskId={focusTask}
            client={client}
            onCopilotUpdate={onCopilotUpdate}
            onReady={setGanttApi}
          />
        </div>

        <div className="border-t border-neutral-200 bg-white">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize invoice ledger"
            aria-valuemin={LEDGER_MIN}
            aria-valuemax={900}
            aria-valuenow={ariaNow}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={() => {
              setSnapping(true);
              setLedgerHeight(LEDGER_DEFAULT);
              setLedgerOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSnapping(true);
                setLedgerOpen(true);
                setLedgerHeight(boundHeight(measuredHeight() + 24, false));
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSnapping(true);
                setLedgerHeight(boundHeight(measuredHeight() - 24, false));
              }
            }}
            className={`pp-split-handle ${ledgerOpen ? "" : "cursor-default"}`}
          />
          <div className="flex items-center justify-between gap-4 px-6 pb-2">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLedgerOpen((open) => !open)}
                aria-expanded={ledgerOpen}
                aria-label={ledgerOpen ? "Collapse panel" : "Expand panel"}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block transition-transform duration-[var(--dur-ui)] ease-[var(--ease-out)] ${
                    ledgerOpen ? "rotate-90" : ""
                  }`}
                >
                  ▸
                </span>
              </Button>
              <div role="tablist" aria-label="Bottom panel" className="flex gap-1">
                {(
                  [
                    ["invoices", `PayPal invoices (${invoices.length})`],
                    ["activity", "Agent activity"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    id={`tab-${key}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    aria-controls={`panel-${key}`}
                    tabIndex={tab === key ? 0 : -1}
                    onClick={() => selectTab(key)}
                    onKeyDown={(event) => onTabKey(event, key)}
                    className={`pp-btn pp-btn-sm relative ${
                      tab === key ? "bg-ink text-white" : "text-ink-muted hover:bg-neutral-100"
                    }`}
                  >
                    {label}
                    {key === "activity" && activity.unread && tab !== "activity" && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-600">
                        <span className="sr-only">New activity</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {busy && (
                <span className="text-xs text-blue-800" aria-live="polite">
                  {busy}
                </span>
              )}
              {error && (
                <span role="alert" className="text-xs text-red-700">
                  {error}{" "}
                  <button type="button" onClick={invoicesApi.clearError} className="underline">
                    Dismiss
                  </button>
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void invoicesApi.refresh()}
            >
              Refresh from PayPal
            </Button>
          </div>
          <div
            ref={panelRef}
            className={`pp-ledger-panel ${snapping ? "pp-ledger-panel-snap" : ""}`}
            style={{ height: panelHeight }}
          >
            <div
              id="panel-activity"
              role="tabpanel"
              aria-labelledby="tab-activity"
              hidden={tab !== "activity"}
              className="pp-ledger h-full"
            >
              <ActivityClient items={activity.items} />
            </div>
            <div
              id="panel-invoices"
              role="tabpanel"
              aria-labelledby="tab-invoices"
              hidden={tab !== "invoices"}
              className="flex h-full"
            >
              <div className="w-[clamp(260px,30vw,380px)] shrink-0 border-r border-neutral-200">
                <CashChart milestones={schedule.cash} today={clock.today} />
              </div>
              <div className="pp-ledger min-w-0 flex-1">
                <LedgerClient
                  invoices={invoices}
                  today={clock.today}
                  busy={Boolean(busy)}
                  onAction={(action, invoice) =>
                    runAction(action, invoice, invoice.taskId ?? 0, invoice.milestoneName)
                  }
                  onSelect={(invoice) => invoice.taskId && setFocusTask({ id: invoice.taskId })}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {sending && (
        <SendInvoiceDialog
          milestone={sending}
          client={client}
          termsDays={project.paymentTermsDays}
          today={clock.today}
          currency={project.currency}
          api={ganttApi}
          onCancel={() => setSending(null)}
          onSend={(discount) => {
            void invoicesApi.send(sending.taskId, sending.name, discount);
            setSending(null);
          }}
        />
      )}
      {qrInvoice && (
        <QrDialog projectId={project.id} invoice={qrInvoice} onClose={() => setQrInvoice(null)} />
      )}
    </main>
  );
}
