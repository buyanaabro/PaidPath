"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ActivityClient from "@/components/activity/ActivityClient";
import { useActivity } from "@/components/activity/useActivity";
import AppHeader from "@/components/AppHeader";
import GanttClient from "@/components/gantt/GanttClient";
import type { GateState, ScheduleInfo } from "@/components/gantt/PlanGantt";
import { SaveStatusPill, type SaveStatus } from "@/components/gantt/save-status";
import CashChart from "@/components/invoices/CashChart";
import LedgerClient from "@/components/invoices/LedgerClient";
import QrDialog from "@/components/invoices/QrDialog";
import {
  useInvoices,
  type InvoiceAction,
  type InvoicesSnapshot,
} from "@/components/invoices/useInvoices";
import { formatDate, formatMoney } from "@/lib/format";
import { daysBetween } from "@/lib/gates";
import type { ActivityItem } from "@/server/activity";
import type { InvoiceView } from "@/server/invoicing/service";
import DemoClock, { type ClockState } from "./DemoClock";
import PlanDraftBanner from "./PlanDraftBanner";

type Props = {
  project: {
    id: number;
    name: string;
    clientName: string;
    clientEmail: string;
    status: "draft" | "active";
    total: string;
    currency: string;
    paymentTermsDays: number;
  };
  initialInvoices: InvoicesSnapshot;
  initialClock: ClockState;
  initialActivity: ActivityItem[];
};

const LEDGER_MIN = 140;
const LEDGER_DEFAULT = 270;

export default function ProjectWorkspace({ project, initialInvoices, initialClock, initialActivity }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  // Bumped after the AI replaces the plan, remounting the Gantt so it reloads.
  const [planVersion, setPlanVersion] = useState(0);
  const [focusTask, setFocusTask] = useState<{ id: number } | null>(null);
  const [qrInvoice, setQrInvoice] = useState<InvoiceView | null>(null);
  const [ledgerHeight, setLedgerHeight] = useState(LEDGER_DEFAULT);
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [tab, setTab] = useState<"invoices" | "activity">("invoices");
  const splitRef = useRef<HTMLElement>(null);
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
      })),
    }),
    [clock, invoices, project.paymentTermsDays],
  );
  const slip =
    schedule.finish && schedule.baselineFinish ? daysBetween(schedule.baselineFinish, schedule.finish) : null;

  const runAction = useCallback(
    (action: InvoiceAction, invoice: InvoiceView | undefined, taskId: number, name: string) => {
      if (action === "send") return void invoicesApi.send(taskId, name);
      if (!invoice) return;
      if (action === "remind") return void invoicesApi.remind(invoice.id);
      if (action === "record-payment") return void invoicesApi.recordPayment(invoice.id);
      if (action === "qr") return setQrInvoice(invoice);
      if (action === "pay-page" && invoice.payUrl) window.open(invoice.payUrl, "_blank", "noopener");
    },
    [invoicesApi],
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

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const bottom = splitRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    const onMove = (move: PointerEvent) =>
      setLedgerHeight(Math.min(Math.max(bottom - move.clientY, LEDGER_MIN), window.innerHeight * 0.7));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const totals = invoices.reduce(
    (sum, invoice) => {
      if (invoice.status === "sent") sum.outstanding += invoice.amountCents;
      if (invoice.status === "paid") sum.paid += invoice.amountCents;
      return sum;
    },
    { outstanding: 0, paid: 0 },
  );

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
        <SaveStatusPill status={saveStatus} />
      </AppHeader>
      <div className="flex items-end justify-between gap-4 border-b border-neutral-200 px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-neutral-500">Client: {project.clientName}</p>
        </div>
        <div className="flex gap-5 text-sm text-neutral-600">
          {schedule.finish && (
            <span data-testid="finish-kpi">
              Projected finish{" "}
              <span className="font-semibold tabular-nums text-neutral-900">{formatDate(schedule.finish)}</span>
              {slip !== null && slip !== 0 && (
                <span className={`ml-1 font-semibold ${slip > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {" "}
                  {slip > 0 ? `+${slip}` : slip} days vs baseline
                </span>
              )}
              {slip === 0 && <span className="ml-1 text-neutral-500"> on baseline</span>}
            </span>
          )}
          <span>
            Contract <span className="font-semibold tabular-nums text-neutral-900">{project.total}</span>
          </span>
          <span>
            Paid{" "}
            <span className="font-semibold tabular-nums text-emerald-700">
              {formatMoney(totals.paid, project.currency)}
            </span>
          </span>
          <span>
            Outstanding{" "}
            <span className="font-semibold tabular-nums text-blue-700">
              {formatMoney(totals.outstanding, project.currency)}
            </span>
          </span>
        </div>
      </div>
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
          />
        </div>

        <div className="border-t border-neutral-200 bg-white">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize invoice ledger"
            onPointerDown={ledgerOpen ? startResize : undefined}
            className={`h-1.5 ${ledgerOpen ? "cursor-row-resize hover:bg-neutral-200" : ""}`}
          />
          <div className="flex items-center justify-between gap-4 px-6 pb-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLedgerOpen((open) => !open)}
                aria-expanded={ledgerOpen}
                aria-label={ledgerOpen ? "Collapse panel" : "Expand panel"}
                className="text-sm font-semibold hover:text-neutral-600"
              >
                {ledgerOpen ? "▾" : "▸"}
              </button>
              <div role="tablist" aria-label="Bottom panel" className="flex gap-1">
                {(
                  [
                    ["invoices", `PayPal invoices (${invoices.length})`],
                    ["activity", "Agent activity"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => {
                      setTab(key);
                      setLedgerOpen(true);
                      if (key === "activity") activity.markSeen();
                    }}
                    className={`relative rounded-md px-2 py-0.5 text-sm font-semibold ${
                      tab === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {label}
                    {key === "activity" && activity.unread && tab !== "activity" && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-600" aria-label="new activity" />
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
            <button
              type="button"
              onClick={() => void invoicesApi.refresh()}
              className="text-xs text-neutral-600 hover:text-neutral-900"
            >
              Refresh from PayPal
            </button>
          </div>
          {ledgerOpen && tab === "activity" && (
            <div className="pp-ledger" style={{ height: ledgerHeight }}>
              <ActivityClient items={activity.items} />
            </div>
          )}
          {ledgerOpen && tab === "invoices" && (
            <div className="flex" style={{ height: ledgerHeight }}>
              <div className="w-[380px] shrink-0 border-r border-neutral-200">
                <CashChart milestones={schedule.cash} today={clock.today} />
              </div>
              <div className="pp-ledger min-w-0 flex-1">
                <LedgerClient
                  invoices={invoices}
                  busy={Boolean(busy)}
                  onAction={(action, invoice) =>
                    runAction(action, invoice, invoice.taskId ?? 0, invoice.milestoneName)
                  }
                  onSelect={(invoice) => invoice.taskId && setFocusTask({ id: invoice.taskId })}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {qrInvoice && (
        <QrDialog projectId={project.id} invoice={qrInvoice} onClose={() => setQrInvoice(null)} />
      )}
    </main>
  );
}
