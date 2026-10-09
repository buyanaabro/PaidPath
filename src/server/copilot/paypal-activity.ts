type Money = { currency_code?: string; value?: string };
type PayPalTransactions = {
  transaction_details?: {
    transaction_info?: {
      transaction_id?: string;
      transaction_event_code?: string;
      transaction_initiation_date?: string;
      transaction_amount?: Money;
      fee_amount?: Money;
      transaction_status?: string;
      transaction_subject?: string;
      transaction_note?: string;
      invoice_id?: string;
      ending_balance?: Money;
    };
    payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
  }[];
  last_refreshed_datetime?: string;
};

const STATUS: Record<string, string> = { S: "completed", P: "pending", D: "denied", V: "reversed" };

/** PayPal's reporting format, trimmed to what the copilot needs to talk about money. */
export function summarizeTransactions(raw: unknown, limit = 20) {
  const data = raw as PayPalTransactions;
  const rows = (data.transaction_details ?? [])
    .map(({ transaction_info: t = {}, payer_info: payer }) => ({
      id: t.transaction_id ?? null,
      date: t.transaction_initiation_date?.slice(0, 10) ?? null,
      amount: t.transaction_amount?.value ? Number(t.transaction_amount.value) : null,
      currency: t.transaction_amount?.currency_code ?? null,
      fee: t.fee_amount?.value ? Number(t.fee_amount.value) : null,
      status: STATUS[t.transaction_status ?? ""] ?? t.transaction_status ?? null,
      description: t.transaction_subject ?? t.transaction_note ?? t.transaction_event_code ?? null,
      invoiceId: t.invoice_id ?? null,
      payer: payer?.payer_name?.alternate_full_name ?? payer?.email_address ?? null,
      balanceAfter: t.ending_balance?.value ? Number(t.ending_balance.value) : null,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const received = rows.filter((r) => r.status === "completed" && (r.amount ?? 0) > 0);
  return {
    count: rows.length,
    receivedTotal: Math.round(received.reduce((sum, r) => sum + (r.amount ?? 0), 0) * 100) / 100,
    latestBalance: rows.find((r) => r.balanceAfter !== null)?.balanceAfter ?? null,
    lastRefreshed: data.last_refreshed_datetime ?? null,
    transactions: rows.slice(0, limit),
    note: "PayPal transaction search can lag a few hours behind; manually recorded (sandbox) payments do not appear here.",
  };
}

/** ISO range for the last `days` days (PayPal allows at most 31). */
export function transactionRange(days: number, now = new Date()) {
  const span = Math.min(Math.max(Math.round(days) || 30, 1), 31);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
  return { start_date: fmt(new Date(now.getTime() - span * 86_400_000)), end_date: fmt(now) };
}
