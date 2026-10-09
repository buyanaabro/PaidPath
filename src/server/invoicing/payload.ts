export const centsToValue = (cents: number) => (cents / 100).toFixed(2);

export type InvoicePayloadInput = {
  projectId: number;
  projectName: string;
  clientEmail: string;
  clientName: string;
  currency: string;
  taskId: number;
  phaseName: string;
  milestoneName: string;
  amountCents: number;
  note: string;
  invoiceDate: string;
  /** Early-payment discount as a PayPal line-item discount (removed when it expires). */
  discountPercent?: number | null;
};

/** Arguments for the toolkit's `create_invoice` tool. */
export function buildInvoicePayload(input: InvoicePayloadInput) {
  const milestone = input.milestoneName.replace(/^Milestone:\s*/i, "");
  return {
    currency_code: input.currency,
    invoice_date: input.invoiceDate,
    reference: `PaidPath #${input.projectId}/${input.taskId}`.slice(0, 120),
    note: input.note.slice(0, 4000),
    primary_recipients: [
      {
        billing_info: {
          email_address: input.clientEmail,
          business_name: input.clientName.slice(0, 300),
        },
      },
    ],
    items: [
      {
        name: `${input.phaseName} — ${milestone}`.slice(0, 200),
        description: input.projectName.slice(0, 1000),
        quantity: "1",
        unit_amount: { currency_code: input.currency, value: centsToValue(input.amountCents) },
        ...(input.discountPercent ? { discount: { percent: String(input.discountPercent) } } : {}),
      },
    ],
  };
}

/** `generate_invoice_qr_code` returns a multipart body; extract the base64 PNG. */
export function extractQrPng(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)\r?\n--/);
  const base64 = (match?.[1] ?? raw).replace(/\s+/g, "");
  return base64.startsWith("iVBOR") ? base64 : null;
}

/** Invoice note = drafted note + PaidPath's own lines (portal link, discount terms). */
export const composeNote = (base: string, extras: (string | null | undefined)[]) =>
  [base.trim(), ...extras.filter((line): line is string => Boolean(line))].join("\n\n").slice(0, 4000);

/** Removes PaidPath lines that start with `prefix` (e.g. the discount offer) from a note. */
export const withoutLine = (note: string, prefix: string) =>
  note
    .split("\n\n")
    .filter((paragraph) => !paragraph.startsWith(prefix))
    .join("\n\n");
