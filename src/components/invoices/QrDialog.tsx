"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import type { InvoiceView } from "@/server/invoicing/service";

type Props = { projectId: number; invoice: InvoiceView; onClose: () => void };

export default function QrDialog({ projectId, invoice, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Dialog
      open
      onClose={onClose}
      label="Pay with PayPal QR code"
      className="text-center"
      initialFocusRef={closeRef}
    >
      <h2 className="text-lg font-semibold">Scan to pay with PayPal</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Invoice {invoice.invoiceNumber} ·{" "}
        {invoice.milestoneName.replace(/^Milestone:\s*/i, "")}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic PNG */}
      <img
        src={`/api/projects/${projectId}/invoices/${invoice.id}/qr`}
        alt="PayPal invoice QR code"
        width={220}
        height={220}
        className="mx-auto my-4"
      />
      {invoice.payUrl && (
        <div className="flex items-center gap-2 text-left">
          <input
            readOnly
            value={invoice.payUrl}
            className="pp-field min-w-0 flex-1 text-xs"
            onFocus={(event) => event.target.select()}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invoice.payUrl!);
                setCopyError(null);
                setCopied(true);
              } catch {
                setCopyError("Couldn’t copy the link.");
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
      {copyError && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {copyError}
        </p>
      )}
      <Button ref={closeRef} className="mt-5" onClick={onClose}>
        Close
      </Button>
    </Dialog>
  );
}
