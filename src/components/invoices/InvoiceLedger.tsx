"use client";

import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import "@/components/gantt/paidpath-gantt.css";

import { StringHelper, type Model } from "@bryntum/gantt";
import { BryntumGrid } from "@bryntum/gantt-react";
import { useMemo } from "react";
import type { InvoiceView } from "@/server/invoicing/service";
import type { InvoiceAction } from "./useInvoices";

type Row = InvoiceView;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const shortDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";
const button = (action: InvoiceAction, label: string, primary = false) =>
  `<button type="button" class="pp-action${primary ? " pp-action-primary" : ""}" data-pp-action="${action}">${label}</button>`;

type Props = {
  invoices: InvoiceView[];
  busy: boolean;
  onAction: (action: InvoiceAction, invoice: InvoiceView) => void;
  onSelect: (invoice: InvoiceView) => void;
};

export default function InvoiceLedger({ invoices, busy, onAction, onSelect }: Props) {
  // Bryntum stores mutate their data arrays, so hand the grid copies.
  const data = useMemo(() => invoices.map((invoice) => ({ ...invoice })), [invoices]);
  const byId = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  return (
    <BryntumGrid
      data={data}
      rowHeight={44}
      emptyText="No invoices yet — send the first milestone invoice from the timeline."
      columns={[
        { text: "Invoice #", field: "invoiceNumber", width: 90 },
        {
          text: "Milestone",
          field: "milestoneName",
          flex: 1,
          minWidth: 160,
          renderer: ({ value }: { value: string }) => value.replace(/^Milestone:\s*/i, ""),
        },
        {
          text: "Amount",
          field: "amountCents",
          width: 105,
          align: "end",
          renderer: ({ record }: { record: Model }) => {
            const row = record as unknown as Row;
            return money(row.amountCents, row.currency);
          },
        },
        {
          text: "Status",
          field: "status",
          width: 160,
          htmlEncode: false,
          renderer: ({ record }: { record: Model }) => {
            const row = record as unknown as Row;
            const key = row.overdue ? "overdue" : row.status;
            const label = row.overdue ? "Overdue" : (STATUS_LABEL[row.status] ?? row.status);
            return `<span class="pp-pill pp-pill-${StringHelper.encodeHtml(key)}">${StringHelper.encodeHtml(label)}</span>`;
          },
        },
        { text: "Sent", field: "sentAt", width: 85, renderer: ({ value }: { value: string | null }) => shortDate(value) },
        { text: "Due", field: "dueAt", width: 85, renderer: ({ value }: { value: string | null }) => shortDate(value) },
        { text: "Paid", field: "paidAt", width: 85, renderer: ({ value }: { value: string | null }) => shortDate(value) },
        { text: "Reminders", field: "reminderCount", width: 100, align: "center" },
        {
          text: "Note",
          field: "noteSource",
          width: 90,
          htmlEncode: false,
          renderer: ({ record }: { record: Model }) => {
            const row = record as unknown as Row;
            return row.noteSource === "ai"
              ? `<span class="pp-pill pp-pill-ai" title="${StringHelper.encodeHtml(row.note ?? "")}">AI note</span>`
              : `<span class="pp-pill pp-pill-none" title="${StringHelper.encodeHtml(row.note ?? "")}">Template</span>`;
          },
        },
        {
          text: "Actions",
          field: "id",
          width: 400,
          htmlEncode: false,
          sortable: false,
          renderer: ({ record }: { record: Model }) => {
            const row = record as unknown as Row;
            const actions = [];
            if (row.payUrl) actions.push(button("pay-page", "Client pay page"));
            if (row.hasQr) actions.push(button("qr", "QR"));
            if (row.status === "sent") {
              actions.push(button("remind", "Remind"));
              actions.push(button("record-payment", "Record payment", true));
            }
            return `<div class="pp-invoice-cell">${actions.join("")}</div>`;
          },
        },
      ]}
      onCellClick={({ record, event }) => {
        const invoice = byId.get(Number(record.id));
        if (!invoice) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pp-action]");
        if (target) {
          if (!busy) onAction(target.dataset.ppAction as InvoiceAction, invoice);
        } else {
          onSelect(invoice);
        }
      }}
    />
  );
}
