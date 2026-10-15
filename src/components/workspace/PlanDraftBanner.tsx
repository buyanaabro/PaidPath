"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptPlan, regeneratePlan } from "@/app/projects/actions";
import Button from "@/components/ui/Button";

type Props = {
  projectId: number;
  onRegenerated: () => void;
};

export default function PlanDraftBanner({ projectId, onRegenerated }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"accept" | "regenerate" | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Explicit busy state instead of transition pending: remounting the Gantt after a
  // regenerate keeps a wrapping transition pending long after the work is done.
  const pending = busy !== null;

  const run = async (kind: "accept" | "regenerate") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "accept") {
        await acceptPlan(projectId);
      } else {
        const result = await regeneratePlan(projectId, feedback);
        if ("error" in result) {
          setError(result.error ?? "Could not regenerate the plan.");
          return;
        }
        setFeedback("");
        setShowFeedback(false);
        onRegenerated();
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b border-violet-200 bg-violet-50 px-6 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-violet-900">
          <span className="font-semibold">AI draft.</span> Review the phases,
          durations and milestone prices — edit anything on the timeline, then
          accept the plan.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setShowFeedback((v) => !v)}
          >
            Regenerate…
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run("accept")}
          >
            {busy === "accept" ? "Accepting…" : "Accept plan"}
          </Button>
        </div>
      </div>

      <div className={`pp-reveal ${showFeedback ? "pp-reveal-open" : ""}`}>
        <div className="pp-reveal-inner">
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run("regenerate");
            }}
          >
            <input
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={pending}
              maxLength={500}
              placeholder="What should change? e.g. “shorter discovery, add a training phase”"
              className="pp-field min-w-64 flex-1"
            />
            <Button type="submit" size="sm" disabled={pending}>
              {busy === "regenerate" ? "Re-planning…" : "Regenerate plan"}
            </Button>
          </form>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
