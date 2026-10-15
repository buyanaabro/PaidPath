"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

/** Opens the read-only client portal and copies its link (created on first use). */
export default function ClientViewButton({ projectId }: { projectId: number }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">(
    "idle",
  );

  const open = async () => {
    setState("busy");
    // Open synchronously (popup blockers), then point it at the portal.
    const tab = window.open("", "_blank");
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, {
        method: "POST",
      });
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
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={open}
      disabled={state === "busy"}
      title="Read-only page for your client: timeline, what's due, PayPal pay buttons"
    >
      {state === "copied"
        ? "Link copied"
        : state === "error"
          ? "Try again"
          : "Client view ↗"}
    </Button>
  );
}
