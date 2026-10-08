"use client";

import { buildCashSeries, cashRange, type CashPoint, type MilestoneCash } from "@/lib/cashflow";
import { daysBetween, type IsoDate } from "@/lib/gates";

const W = 360;
const H = 150;
const PAD = { left: 8, right: 52, top: 26, bottom: 20 };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(cents / 100);
const short = (date: IsoDate) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );

type Props = { milestones: MilestoneCash[]; today: IsoDate };

/** Cumulative cash-in: planned (baseline) vs projected (payment-aware) vs received. */
export default function CashChart({ milestones, today }: Props) {
  const series = buildCashSeries(milestones);
  const total = milestones.reduce((sum, m) => sum + m.amountCents, 0);
  if (!total || !series.projected.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-xs text-neutral-500">
        Cash projection appears once the plan has priced milestones.
      </div>
    );
  }

  const range = cashRange(series, today);
  const x = (date: IsoDate) =>
    PAD.left + (daysBetween(range.from, date) / range.days) * (W - PAD.left - PAD.right);
  const y = (cents: number) => H - PAD.bottom - (cents / total) * (H - PAD.top - PAD.bottom);
  const step = (points: CashPoint[], extendTo: IsoDate) => {
    if (!points.length) return "";
    let d = `M${x(range.from)},${y(0)}`;
    let level = 0;
    for (const p of points) {
      d += ` H${x(p.date)} V${y(p.cents)}`;
      level = p.cents;
    }
    return `${d} H${x(extendTo)} V${y(level)}`;
  };

  const received = series.received.at(-1)?.cents ?? 0;
  const projectedDone = series.projected.at(-1)!.date;
  const plannedDone = series.planned.at(-1)?.date;

  return (
    <figure className="flex h-full flex-col px-3 py-2" aria-label="Cash projection chart">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        <span className="font-semibold text-neutral-900">Cash in</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-green-600" /> Received {money(received)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-blue-600" /> Projected · all by {short(projectedDone)}
        </span>
        {plannedDone && (
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 border-t border-dashed border-neutral-400" /> Baseline {short(plannedDone)}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" role="img" aria-hidden="true">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(total * f)} y2={y(total * f)} stroke="#f0f0f0" />
            <text x={W - PAD.right + 4} y={y(total * f) + 3} fontSize="9" fill="#737373">
              {money(total * f)}
            </text>
          </g>
        ))}
        <line x1={x(today)} x2={x(today)} y1={PAD.top - 6} y2={H - PAD.bottom} stroke="#d97706" strokeWidth="1.5" />
        <text x={x(today)} y={PAD.top - 9} fontSize="9" fill="#b45309" textAnchor="middle">
          today
        </text>
        <path d={step(series.planned, range.to)} fill="none" stroke="#a3a3a3" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={step(series.projected, range.to)} fill="none" stroke="#2563eb" strokeWidth="2" />
        <path d={step(series.received, today)} fill="none" stroke="#16a34a" strokeWidth="3" />
        <text x={PAD.left} y={H - 5} fontSize="9" fill="#737373">
          {short(range.from)}
        </text>
        <text x={W - PAD.right} y={H - 5} fontSize="9" fill="#737373" textAnchor="end">
          {short(range.to)}
        </text>
      </svg>
    </figure>
  );
}
