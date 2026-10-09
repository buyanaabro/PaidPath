"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import "@/components/gantt/paidpath-gantt.css";

import { StringHelper, type Model } from "@bryntum/gantt";
import { BryntumGrid } from "@bryntum/gantt-react";
import { useMemo } from "react";
import type { ActivityItem } from "@/server/activity";

const ACTOR_LABEL: Record<ActivityItem["actor"], string> = {
  architect: "AI architect",
  copilot: "Copilot",
  automation: "PaidPath",
  user: "You",
  client: "Client",
};

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

/** Audit trail of every AI, PayPal and clock action on the project. */
export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  // Bryntum stores mutate their data arrays, so hand the grid copies.
  const data = useMemo(() => items.map((item) => ({ ...item })), [items]);
  return (
    <BryntumGrid
      data={data}
      rowHeight={38}
      emptyText="No activity yet — AI and PayPal actions will appear here."
      columns={[
        { text: "When", field: "ts", width: 170, renderer: ({ value }: { value: string }) => time(value) },
        {
          text: "Who",
          field: "actor",
          width: 130,
          htmlEncode: false,
          renderer: ({ record }: { record: Model }) => {
            const { actor } = record as unknown as ActivityItem;
            return `<span class="pp-pill pp-actor-${StringHelper.encodeHtml(actor)}">${StringHelper.encodeHtml(ACTOR_LABEL[actor] ?? actor)}</span>`;
          },
        },
        { text: "What happened", field: "summary", flex: 1, minWidth: 260 },
        {
          text: "Took",
          field: "durationMs",
          width: 80,
          align: "end",
          renderer: ({ value }: { value: number | null }) => (value ? `${(value / 1000).toFixed(1)}s` : "—"),
        },
        {
          text: "Result",
          field: "ok",
          width: 90,
          htmlEncode: false,
          renderer: ({ value }: { value: boolean }) =>
            value ? '<span class="pp-pill pp-pill-paid">OK</span>' : '<span class="pp-pill pp-pill-overdue">Failed</span>',
        },
      ]}
    />
  );
}
