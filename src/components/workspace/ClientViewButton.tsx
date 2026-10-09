"use client";

import { useState } from "react";

/** Opens the read-only client portal and copies its link (created on first use). */
export default function ClientViewButton({ projectId }: { projectId: number }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");

  const open = async () => {
    setState("busy");
    // Open synchronously (popup blockers), then point it at the portal.
    const tab = window.open("", "_blank");
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, { method: "POST" });
      if (!response.ok) throw new Error("share failed");
      const { url } = (await response.json()) as { url: string };
      if (tab) tab.location.href = url;
      else window.location.href = url;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      tab?.close();
      setState("error");
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={state === "busy"}
      title="Read-only page for your client: timeline, what's due, PayPal pay buttons"
      className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
    >
      {state === "copied" ? "Link copied" : state === "error" ? "Try again" : "Client view ↗"}
    </button>
  );
}
