"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { guideProgress, type GuideInput } from "@/lib/demo-guide";
import Button from "@/components/ui/Button";

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
  const hidden = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(KEY) === "1",
    () => false,
  );
  const { steps, current, completed } = guideProgress(input);

  return (
    <section
      aria-label="Demo guide"
      data-testid="demo-guide"
      className={`border-b px-6 ${
        hidden
          ? "border-neutral-200 bg-white py-1.5"
          : "border-sky-200 bg-sky-50 py-2"
      }`}
    >
      {hidden ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHidden(false)}
        >
          Show demo guide ({completed}/{steps.length})
        </Button>
      ) : (
        <>
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
                    step.done
                      ? "text-emerald-800"
                      : step.id === current?.id
                        ? "font-semibold text-ink"
                        : "text-ink-muted"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[11px] ${
                      step.done
                        ? "bg-emerald-600 text-white"
                        : step.id === current?.id
                          ? "bg-sky-700 text-white"
                          : "bg-neutral-200 text-ink-muted"
                    }`}
                  >
                    {step.done ? "✓" : index + 1}
                  </span>
                  {step.title}
                  <span className="sr-only">{step.done ? "(done)" : ""}</span>
                </li>
              ))}
            </ol>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setHidden(true)}
              aria-label="Hide demo guide"
            >
              Hide
            </Button>
          </div>
          <p
            className="mt-0.5 text-xs text-sky-950"
            data-testid="demo-guide-hint"
          >
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
        </>
      )}
    </section>
  );
}
