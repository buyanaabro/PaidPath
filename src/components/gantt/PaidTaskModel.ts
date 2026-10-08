import { TaskModel } from "@bryntum/gantt";

export type InvoiceStatus =
  | "none"
  | "draft"
  | "sent"
  | "overdue"
  | "paid"
  | "cancelled";

export class PaidTaskModel extends TaskModel {
  static $name = "PaidTaskModel";

  static fields = [
    { name: "amount", type: "number" },
    // Owned by the server (PayPal is the source of truth) — never synced back.
    { name: "invoiceStatus", type: "string", defaultValue: "none", persist: false },
    { name: "paymentGate", type: "boolean", defaultValue: false },
    // Date (YYYY-MM-DD) of the payment-gate hold PaidPath placed on this task.
    { name: "gateHold", type: "string" },
  ];

  declare amount: number | null;
  declare invoiceStatus: InvoiceStatus;
  declare paymentGate: boolean;
  declare gateHold: string | null;
}
