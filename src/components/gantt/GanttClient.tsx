"use client";

import dynamic from "next/dynamic";

// Bryntum touches `window` on import, so it must never render on the server.
const PlanGantt = dynamic(() => import("./PlanGantt"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      Loading plan…
    </div>
  ),
});

export default function GanttClient() {
  return <PlanGantt />;
}
