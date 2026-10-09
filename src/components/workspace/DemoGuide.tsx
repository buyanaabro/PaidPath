"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { guideProgress, type GuideInput } from "@/lib/demo-guide";

const KEY = "pp-demo-guide-hidden";
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener("pp-demo-guide", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pp-demo-guide", onChange);
  };
};
const setHidden = (hidden: boolean) => {
  if (hidden) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("pp-demo-guide"));
};

/** Five-step checklist on demo copies; ticks off from real invoices and agent activity. */
export default function DemoGuide(input: GuideInput) {
  const hidden = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) === "1", () => false);
  const { steps, current, completed } = guideProgress(input);

  if (hidden) {
    return (
      <div className="border-b border-neutral-200 bg-white px-6 py-1.5">
        <button type="button" onClick={() => setHidden(false)} className="text-xs font-medium text-neutral-600 hover:text-neutral-900">
          Show demo guide ({completed}/{steps.length})
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Demo guide" data-testid="demo-guide" className="border-b border-sky-200 bg-sky-50 px-6 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-900">
          Demo guide {completed}/{steps.length}
        </span>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {steps.map((step, index) => (
            <li
              key={step.id}
              data-step={step.id}
              data-done={step.done}
              className={`flex items-center gap-1.5 ${
                step.done ? "text-emerald-800" : step.id === current?.id ? "font-semibold text-neutral-900" : "text-neutral-500"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  step.done ? "bg-emerald-600 text-white" : step.id === current?.id ? "bg-sky-700 text-white" : "bg-neutral-200 text-neutral-600"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </span>
              {step.title}
              <span className="sr-only">{step.done ? "(done)" : ""}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide demo guide"
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-900"
        >
          Hide
        </button>
      </div>
      <p className="mt-0.5 text-xs text-sky-950" data-testid="demo-guide-hint">
        {current ? (
          current.hint
        ) : (
          <>
            You&apos;ve seen the whole loop.{" "}
            <Link href="/projects/new" className="font-semibold underline">
              Create your own project from a client brief →
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
