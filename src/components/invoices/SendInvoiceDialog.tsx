"use client";

import { useEffect, useRef, useState } from "react";
import type { GanttApi } from "@/components/gantt/PlanGantt";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import {
  DISCOUNT_PERCENTS,
  DISCOUNT_WINDOWS,
  discountAmountCents,
  suggestDiscount,
  suggestedWindow,
  type DiscountOffer,
} from "@/lib/discount";
import { formatDate, formatMoney } from "@/lib/format";
import { addDays, type IsoDate } from "@/lib/gates";

type Benefit = Awaited<ReturnType<GanttApi["discountBenefit"]>>;

type Props = {
  milestone: { taskId: number; name: string; amountCents: number; isGate: boolean };
  client: { name: string; email: string };
  termsDays: number;
  today: IsoDate;
  currency: string;
  api: GanttApi | null;
  onCancel: () => void;
  onSend: (discount: DiscountOffer | null) => void;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Confirms a milestone invoice and offers an early-payment discount backed by a simulation. */
export default function SendInvoiceDialog({ milestone, client, termsDays, today, currency, api, onCancel, onSend }: Props) {
  // null until the user changes something; until then the suggestion decides.
  const [choice, setChoice] = useState<{ enabled: boolean; percent: number; days: number } | null>(null);
  const [benefits, setBenefits] = useState<Record<number, Benefit | "error">>({});
  const name = milestone.name.replace(/^Milestone:\s*/i, "");
  // A window must end before the due date to mean "early".
  const windows = DISCOUNT_WINDOWS.filter((d) => d < termsDays);
  const money = (cents: number) => formatMoney(cents, currency);

  const baseWindow = suggestedWindow(termsDays);
  const basis = baseWindow === null ? undefined : benefits[baseWindow];
  const suggestion =
    baseWindow === null
      ? { recommended: false, offer: { percent: 2, days: 3 }, reason: `${plural(termsDays, "day")} payment terms are too short for an early-payment discount.` }
      : basis === undefined
        ? null
        : suggestDiscount({
            amountCents: milestone.amountCents,
            isGate: milestone.isGate,
            launchDaysEarlier: basis === "error" || !basis ? null : basis.launchDaysEarlier,
            windowDays: baseWindow,
          });
  const { enabled, percent, days } = choice ?? {
    enabled: Boolean(suggestion?.recommended),
    percent: suggestion?.offer.percent ?? 2,
    days: suggestion?.offer.days ?? baseWindow ?? 3,
  };

  // Simulate each window once on the live plan (headless copy — the Gantt is untouched).
  useEffect(() => {
    if (!api || days in benefits) return;
    let cancelled = false;
    api
      .discountBenefit(milestone.taskId, days)
      .then((benefit) => !cancelled && setBenefits((all) => ({ ...all, [days]: benefit })))
      .catch(() => !cancelled && setBenefits((all) => ({ ...all, [days]: "error" })));
    return () => {
      cancelled = true;
    };
  }, [api, days, benefits, milestone.taskId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const selected = benefits[days];
  const savings = discountAmountCents(milestone.amountCents, percent);
  const choose = (update: Partial<{ enabled: boolean; percent: number; days: number }>) =>
    setChoice({ enabled, percent, days, ...update });
  const sendRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open
      onClose={onCancel}
      labelledBy="send-invoice-title"
      initialFocusRef={sendRef}
    >
        <h2 id="send-invoice-title" className="text-lg font-semibold">
          Send PayPal invoice
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-medium text-ink">{name}</span> —{" "}
          {money(milestone.amountCents)} to {client.name}{" "}
          &lt;{client.email}&gt;, due{" "}
          {formatDate(addDays(today, termsDays))} ({plural(termsDays, "day")}
          ).
        </p>

        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm" data-testid="discount-suggestion">
          {suggestion ? (
            <>
              <p className="text-neutral-800">{suggestion.reason}</p>
              {suggestion.recommended && (
                <p className="mt-1 font-medium text-emerald-800">
                  Suggested: {suggestion.offer.percent}% ({money(discountAmountCents(milestone.amountCents, suggestion.offer.percent))}) if paid
                  within {suggestion.offer.days} days.
                </p>
              )}
            </>
          ) : (
            <p className="text-neutral-500">Simulating the effect of early payment on your plan…</p>
          )}
        </div>

        {windows.length > 0 && (
        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => choose({ enabled: event.target.checked })}
            className="h-4 w-4"
          />
          Offer an early-payment discount
        </label>
        )}
        {enabled && windows.length > 0 && (
          <div className="mt-2 space-y-2 pl-6 text-sm">
            <div className="flex items-center gap-2">
              <select
                aria-label="Discount percent"
                value={percent}
                onChange={(event) => choose({ percent: Number(event.target.value) })}
                className="rounded-md border border-neutral-300 px-2 py-1"
              >
                {DISCOUNT_PERCENTS.map((p) => (
                  <option key={p} value={p}>
                    {p}%
                  </option>
                ))}
              </select>
              <span>if paid within</span>
              <select
                aria-label="Discount window"
                value={days}
                onChange={(event) => choose({ days: Number(event.target.value) })}
                className="rounded-md border border-neutral-300 px-2 py-1"
              >
                {windows.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
            <p className="text-neutral-700" data-testid="discount-effect">
              {client.name} pays {money(milestone.amountCents - savings)} (saves {money(savings)}) by{" "}
              {formatDate(addDays(today, days))}
              {selected && selected !== "error" && selected.launchDaysEarlier > 0
                ? ` — launch moves to ${formatDate(selected.finishIfEarly)}, ${plural(selected.launchDaysEarlier, "day")} earlier than if paid on the due date.`
                : "."}
              {" "}After that the invoice goes back to {money(milestone.amountCents)}.
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            ref={sendRef}
            onClick={() => onSend(enabled ? { percent, days } : null)}
          >
            Send invoice
          </Button>
        </div>
    </Dialog>
  );
}
