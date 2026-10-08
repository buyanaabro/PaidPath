"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type InvoiceLedgerComponent from "./InvoiceLedger";

// Bryntum widgets need `window`, so the ledger renders client-side only.
const InvoiceLedger = dynamic(() => import("./InvoiceLedger"), { ssr: false });

export default function LedgerClient(props: ComponentProps<typeof InvoiceLedgerComponent>) {
  return <InvoiceLedger {...props} />;
}
