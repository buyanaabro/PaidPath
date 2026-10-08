"use client";

import { useEffect, useState } from "react";
import type { InvoiceView } from "@/server/invoicing/service";

type Props = { projectId: number; invoice: InvoiceView; onClose: () => void };

export default function QrDialog({ projectId, invoice, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pay with PayPal QR code"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Scan to pay with PayPal</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Invoice {invoice.invoiceNumber} · {invoice.milestoneName.replace(/^Milestone:\s*/i, "")}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic PNG from our API */}
        <img
          src={`/api/projects/${projectId}/invoices/${invoice.id}/qr`}
          alt="PayPal invoice QR code"
          width={220}
          height={220}
          className="mx-auto my-4"
        />
        {invoice.payUrl && (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={invoice.payUrl}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100"
              onClick={async () => {
                await navigator.clipboard.writeText(invoice.payUrl!);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}
