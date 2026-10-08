"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptPlan, regeneratePlan } from "@/app/projects/actions";

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
          <span className="font-semibold">AI draft.</span> Review the phases, durations and
          milestone prices — edit anything on the timeline, then accept the plan.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowFeedback((v) => !v)}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
          >
            Regenerate…
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("accept")}
            className="rounded-lg bg-violet-700 px-3 py-1.5 font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          >
            {busy === "accept" ? "Accepting…" : "Accept plan"}
          </button>
        </div>
      </div>

      {showFeedback && (
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
            className="min-w-64 flex-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 focus:border-violet-700 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-violet-700 px-3 py-1.5 font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          >
            {busy === "regenerate" ? "Re-planning…" : "Regenerate plan"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
