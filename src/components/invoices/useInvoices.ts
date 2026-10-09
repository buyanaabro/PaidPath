"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InvoiceView } from "@/server/invoicing/service";

export type TaskInvoiceStatus = { taskId: number; invoiceStatus: string; percentDone: number };
export type InvoicesSnapshot = { invoices: InvoiceView[]; taskStatuses: TaskInvoiceStatus[] };

export type InvoiceAction = "send" | "remind" | "record-payment" | "pay-page" | "qr";

const POLL_MS = 15_000;

/** Invoice ledger state + PayPal actions; polls PayPal while invoices are open. */
export function useInvoices(projectId: number, initial: InvoicesSnapshot) {
  const base = `/api/projects/${projectId}/invoices`;
  const [snapshot, setSnapshot] = useState<InvoicesSnapshot>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const request = useCallback(
    async (url: string, init?: RequestInit, label?: string) => {
      if (label) {
        setBusy(label);
        setError(null);
      }
      try {
        const response = await fetch(url, init);
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Request failed");
        setSnapshot({ invoices: body.invoices, taskStatuses: body.taskStatuses });
        return true;
      } catch (err) {
        if (label) setError(err instanceof Error ? err.message : "Request failed");
        return false;
      } finally {
        if (label) setBusy(null);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    await request(`${base}?refresh=1`);
    inFlight.current = false;
  }, [base, request]);

  const hasOpen = snapshot.invoices.some((invoice) => invoice.status === "sent");

  // Poll while something can still change, and re-check when the tab regains focus
  // (e.g. after paying on PayPal in another tab).
  useEffect(() => {
    if (!hasOpen) return;
    const tick = () => document.visibilityState === "visible" && void refresh();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [hasOpen, refresh]);

  const post = (path: string, label: string, body?: unknown) =>
    request(
      `${base}${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      label,
    );

  return {
    ...snapshot,
    busy,
    error,
    clearError: () => setError(null),
    // Stable (state setter) so callers can use it in memoized callbacks.
    replaceSnapshot: setSnapshot as (next: InvoicesSnapshot) => void,
    refresh,
    send: (taskId: number, name: string) =>
      post("", `Invoicing “${name}” — AI is drafting the note, then PayPal creates and sends the invoice…`, { taskId }),
    remind: (invoiceId: number) => post(`/${invoiceId}/remind`, "Sending a PayPal payment reminder…"),
    recordPayment: (invoiceId: number) =>
      post(`/${invoiceId}/record-payment`, "Recording the payment on PayPal (sandbox demo)…"),
  };
}

export type InvoicesApi = ReturnType<typeof useInvoices>;
