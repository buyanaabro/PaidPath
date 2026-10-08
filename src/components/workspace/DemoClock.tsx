"use client";

import { useState } from "react";
import type { InvoicesSnapshot } from "@/components/invoices/useInvoices";
import { formatDate } from "@/lib/format";

export type ClockState = { today: string; simulated: boolean };

type Props = {
  projectId: number;
  clock: ClockState;
  onChange: (clock: ClockState, snapshot: InvoicesSnapshot) => void;
};

/** Per-project demo clock: fast-forward time to show payments landing late or early. */
export default function DemoClock({ projectId, clock, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async (body: { shiftDays: number } | { today: null }) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/clock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Could not move the clock");
      onChange(data.clock, { invoices: data.invoices, taskStatuses: data.taskStatuses });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the clock");
    } finally {
      setBusy(false);
    }
  };

  const button =
    "rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 text-xs" aria-label="Demo clock">
      <span className={clock.simulated ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900" : "text-neutral-600"}>
        {clock.simulated ? "Demo clock" : "Today"}{" "}
        <span className="tabular-nums">{formatDate(clock.today)}</span>
      </span>
      <button type="button" className={button} disabled={busy} onClick={() => move({ shiftDays: -1 })}>
        −1d
      </button>
      <button type="button" className={button} disabled={busy} onClick={() => move({ shiftDays: 1 })}>
        +1d
      </button>
      <button type="button" className={button} disabled={busy} onClick={() => move({ shiftDays: 7 })}>
        +1w
      </button>
      {clock.simulated && (
        <button type="button" className={button} disabled={busy} onClick={() => move({ today: null })}>
          Real date
        </button>
      )}
      {error && (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
