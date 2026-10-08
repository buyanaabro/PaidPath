export type SaveStatus =
  | { state: "idle" | "saving" | "saved" }
  | { state: "error"; message: string; retry: () => void };

const styles = {
  idle: "bg-neutral-100 text-neutral-600",
  saving: "bg-sky-100 text-sky-800",
  saved: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
} as const;

const labels = { idle: "All changes saved", saving: "Saving…", saved: "Saved" } as const;

export function SaveStatusPill({ status }: { status: SaveStatus }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${styles[status.state]}`}
    >
      {status.state === "error" ? (
        <>
          {status.message}
          <button type="button" onClick={status.retry} className="underline underline-offset-2">
            Retry
          </button>
        </>
      ) : (
        labels[status.state]
      )}
    </span>
  );
}
