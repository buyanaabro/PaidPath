"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GateContext } from "@/components/gantt/payment-gates";
import { formatDate, formatMoney } from "@/lib/format";
import { daysBetween, toIsoDate, type IsoDate } from "@/lib/gates";
import type { PortalInvoice, PortalSnapshot } from "@/server/portal-snapshot";
import type { PortalGanttApi } from "./PortalGantt";

const PortalGantt = dynamic(() => import("./PortalGantt"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-neutral-500">Loading timeline…</div>,
});

const POLL_MS = 15_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Effect = { finishNow: IsoDate | null; finishIfPaidToday: IsoDate | null } | null;

/** Read-only client view: their timeline, what's due, PayPal pay buttons. */
export default function PortalView({ token, initial }: { token: string; initial: PortalSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [api, setApi] = useState<PortalGanttApi | null>(null);
  const [schedule, setSchedule] = useState<{ finish: IsoDate | null; baselineFinish: IsoDate | null }>({
    finish: null,
    baselineFinish: null,
  });
  const [effects, setEffects] = useState<Record<string, Effect>>({});
  const requested = useRef(new Set<string>());
  const [qrFor, setQrFor] = useState<number | null>(null);
  const { project, invoices } = snapshot;
  const money = (cents: number) => formatMoney(cents, project.currency);

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/portal/${token}`, { cache: "no-store" });
        if (response.ok) setSnapshot(await response.json());
      } catch {
        // Next poll retries.
      }
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [token]);

  const gate = useMemo<GateContext>(
    () => ({
      today: project.today,
      termsDays: project.termsDays,
      invoicesByTask: new Map(
        invoices
          .filter((i) => i.taskId !== null)
          .map((i) => [i.taskId!, { status: i.status as "sent" | "paid", dueAt: i.dueAt, paidAt: i.paidAt }]),
      ),
    }),
    [project.today, project.termsDays, invoices],
  );

  const open = invoices.filter((i) => i.status === "sent");
  const paid = invoices.filter((i) => i.status === "paid");
  const effectKey = (invoice: PortalInvoice) => `${invoice.id}:${project.today}:${schedule.finish}`;

  // "Pay today → launch moves to …", simulated on a copy of the client's timeline.
  useEffect(() => {
    if (!api || !schedule.finish) return;
    for (const invoice of open) {
      const key = effectKey(invoice);
      if (invoice.taskId === null || requested.current.has(key)) continue;
      requested.current.add(key);
      api
        .payTodayEffect(invoice.taskId)
        .then((effect) => setEffects((all) => ({ ...all, [key]: effect })))
        .catch(() => setEffects((all) => ({ ...all, [key]: null })));
    }
  }); // after every render; `requested` keeps it to one simulation per invoice, day and schedule

  const onReady = useCallback((next: PortalGanttApi) => setApi(next), []);
  const ahead = schedule.finish && schedule.baselineFinish ? daysBetween(schedule.finish, schedule.baselineFinish) : null;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-50 lg:h-screen">
      <header className="border-b border-neutral-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Project timeline for {project.clientName}</p>
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          </div>
          <div className="text-sm text-neutral-700" data-testid="portal-launch">
            {schedule.finish ? (
              <>
                Projected launch <span className="font-semibold text-neutral-900">{formatDate(schedule.finish)}</span>
                {ahead !== null && ahead > 0 && <span className="ml-1 font-medium text-emerald-700">· {plural(ahead, "day")} ahead of plan</span>}
                {ahead !== null && ahead < 0 && <span className="ml-1 font-medium text-amber-700">· {plural(-ahead, "day")} behind plan</span>}
              </>
            ) : (
              "Loading schedule…"
            )}
          </div>
        </div>
        {project.simulated && (
          <p className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Demo clock: {formatDate(project.today)}
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label="Payments" className="w-full shrink-0 overflow-y-auto border-neutral-200 bg-white p-5 lg:w-[400px] lg:border-r">
          <h2 className="text-sm font-semibold">Payments</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Each phase starts once the previous milestone is paid, so paying sooner can bring your launch forward.
          </p>
          {open.length === 0 && <p className="mt-4 text-sm text-neutral-600">Nothing is due right now. Thank you!</p>}
          <ul className="mt-3 space-y-3">
            {open.map((invoice) => {
              const effect = effects[effectKey(invoice)];
              const due = invoice.dueAt ? toIsoDate(invoice.dueAt) : null;
              const discount = invoice.discount?.state === "active" ? invoice.discount : null;
              const sooner =
                effect?.finishIfPaidToday && effect.finishNow && effect.finishIfPaidToday < effect.finishNow
                  ? daysBetween(effect.finishIfPaidToday, effect.finishNow)
                  : 0;
              return (
                <li key={invoice.id} className="rounded-xl border border-neutral-200 p-4" data-testid="portal-invoice">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{invoice.milestone}</p>
                      <p className="text-xs text-neutral-500">Invoice #{invoice.number}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{money(discount ? discount.discountedCents : invoice.amountCents)}</p>
                      {discount && <p className="text-xs text-neutral-500 line-through">{money(invoice.amountCents)}</p>}
                    </div>
                  </div>
                  <p className={`mt-2 text-xs font-medium ${invoice.overdue ? "text-red-700" : "text-neutral-600"}`}>
                    {invoice.overdue && due ? `Overdue since ${formatDate(due)}` : due ? `Due ${formatDate(due)}` : "Due on receipt"}
                  </p>
                  {discount && (
                    <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900" data-testid="portal-discount">
                      Pay by {formatDate(discount.until)} and save {money(discount.savingsCents)} ({discount.percent}% early-payment discount)
                    </p>
                  )}
                  {sooner > 0 && effect?.finishIfPaidToday && (
                    <p className="mt-2 text-xs text-emerald-800" data-testid="portal-pay-today">
                      Pay today → launch moves to <b>{formatDate(effect.finishIfPaidToday)}</b> (instead of {formatDate(effect.finishNow!)})
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {invoice.payUrl && (
                      <a
                        href={invoice.payUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-[#0070ba] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#005ea6]"
                      >
                        Pay with PayPal
                      </a>
                    )}
                    {invoice.hasQr && (
                      <button
                        type="button"
                        onClick={() => setQrFor((id) => (id === invoice.id ? null : invoice.id))}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                        aria-expanded={qrFor === invoice.id}
                      >
                        {qrFor === invoice.id ? "Hide QR" : "Scan to pay"}
                      </button>
                    )}
                  </div>
                  {qrFor === invoice.id && (
                    // eslint-disable-next-line @next/next/no-img-element -- dynamic PNG from our API
                    <img
                      src={`/api/portal/${token}/invoices/${invoice.id}/qr`}
                      alt={`PayPal QR code for invoice ${invoice.number}`}
                      width={180}
                      height={180}
                      className="mt-3"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {paid.length > 0 && (
            <>
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">Paid</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {paid.map((invoice) => (
                  <li key={invoice.id} className="flex justify-between gap-3" data-testid="portal-paid">
                    <span>
                      {invoice.milestone}
                      {invoice.discount?.state === "taken" && (
                        <span className="ml-1 text-xs text-emerald-700">(saved {money(invoice.discount.savingsCents)})</span>
                      )}
                    </span>
                    <span className="text-neutral-600">
                      {money(invoice.paidAmountCents ?? invoice.amountCents)} · {invoice.paidAt ? formatDate(toIsoDate(invoice.paidAt)) : "paid"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-8 text-xs text-neutral-400">Shared with you by your project team via PaidPath. Payments are processed by PayPal (sandbox).</p>
        </section>

        <section aria-label="Timeline" className="h-[70vh] flex-none lg:h-auto lg:min-h-0 lg:flex-1">
          <PortalGantt
            token={token}
            gate={gate}
            simulated={project.simulated}
            taskStatuses={snapshot.taskStatuses}
            paidCount={paid.length}
            onReady={onReady}
            onSchedule={setSchedule}
          />
        </section>
      </div>
    </main>
  );
}
