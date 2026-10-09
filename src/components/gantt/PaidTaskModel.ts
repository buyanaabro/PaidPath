import { TaskModel } from "@bryntum/gantt";

export type InvoiceStatus =
  | "none"
  | "draft"
  | "sent"
  | "overdue"
  | "paid"
  | "cancelled";

export class PaidTaskModel extends TaskModel {
  // Bryntum's AI agent derives tool names from this (getTasks, updateTasks, ...).
  static $name = "Task";

  // `description`s are shown to the AI agent.
  static fields = [
    {
      name: "amount",
      type: "number",
      description: "Milestone price in USD invoiced to the client via PayPal (milestones only). Read-only.",
    },
    // Owned by the server (PayPal is the source of truth) — never synced back.
    {
      name: "invoiceStatus",
      type: "string",
      defaultValue: "none",
      persist: false,
      description: "PayPal invoice state of a priced milestone: none, sent, paid, cancelled. Read-only — use the invoice tools.",
    },
    {
      name: "paymentGate",
      type: "boolean",
      defaultValue: false,
      description: "True if the next phase waits until this milestone is paid. Read-only.",
    },
    // Date (YYYY-MM-DD) of the payment-gate hold PaidPath placed on this task.
    {
      name: "gateHold",
      type: "string",
      description: "If set, this task is held until the client is expected to pay (YYYY-MM-DD). Managed by PaidPath — do not edit.",
    },
  ];

  declare amount: number | null;
  declare invoiceStatus: InvoiceStatus;
  declare paymentGate: boolean;
  declare gateHold: string | null;
}
