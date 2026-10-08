"use client";

import { useCallback, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import GanttClient from "@/components/gantt/GanttClient";
import { SaveStatusPill, type SaveStatus } from "@/components/gantt/save-status";
import LedgerClient from "@/components/invoices/LedgerClient";
import QrDialog from "@/components/invoices/QrDialog";
import {
  useInvoices,
  type InvoiceAction,
  type InvoicesSnapshot,
} from "@/components/invoices/useInvoices";
import { formatMoney } from "@/lib/format";
import type { InvoiceView } from "@/server/invoicing/service";
import PlanDraftBanner from "./PlanDraftBanner";

type Props = {
  project: {
    id: number;
    name: string;
    clientName: string;
    status: "draft" | "active";
    total: string;
    currency: string;
  };
  initialInvoices: InvoicesSnapshot;
};

const LEDGER_MIN = 140;
const LEDGER_DEFAULT = 270;

export default function ProjectWorkspace({ project, initialInvoices }: Props) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  // Bumped after the AI replaces the plan, remounting the Gantt so it reloads.
  const [planVersion, setPlanVersion] = useState(0);
  const [focusTask, setFocusTask] = useState<{ id: number } | null>(null);
  const [qrInvoice, setQrInvoice] = useState<InvoiceView | null>(null);
  const [ledgerHeight, setLedgerHeight] = useState(LEDGER_DEFAULT);
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const splitRef = useRef<HTMLElement>(null);
  const invoicesApi = useInvoices(project.id, initialInvoices);
  const { invoices, busy, error } = invoicesApi;

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
        <SaveStatusPill status={saveStatus} />
      </AppHeader>
      <div className="flex items-end justify-between gap-4 border-b border-neutral-200 px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
          <p className="text-xs text-neutral-500">Client: {project.clientName}</p>
        </div>
        <div className="flex gap-5 text-sm text-neutral-600">
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
            focusTaskId={focusTask}
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
                className="text-sm font-semibold hover:text-neutral-600"
              >
                {ledgerOpen ? "▾" : "▸"} PayPal invoices ({invoices.length})
              </button>
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
          {ledgerOpen && (
            <div className="pp-ledger" style={{ height: ledgerHeight }}>
              <LedgerClient
                invoices={invoices}
                busy={Boolean(busy)}
                onAction={(action, invoice) =>
                  runAction(action, invoice, invoice.taskId ?? 0, invoice.milestoneName)
                }
                onSelect={(invoice) => invoice.taskId && setFocusTask({ id: invoice.taskId })}
              />
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
