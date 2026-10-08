"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type PlanGanttComponent from "./PlanGantt";

// Bryntum touches `window` on import, so it must never render on the server.
const PlanGantt = dynamic(() => import("./PlanGantt"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      Loading plan…
    </div>
  ),
});

export default function GanttClient(props: ComponentProps<typeof PlanGanttComponent>) {
  return <PlanGantt {...props} />;
}
