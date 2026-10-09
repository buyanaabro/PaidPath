"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityItem } from "@/server/activity";

const POLL_MS = 10_000;

/**
 * Agent activity feed; polls while the page is visible (copilot turns are logged server-side)
 * and refetches whenever `changeKey` changes (invoice or clock updates).
 */
export function useActivity(projectId: number, initial: ActivityItem[], changeKey: unknown) {
  const [items, setItems] = useState(initial);
  const [seenId, setSeenId] = useState(initial[0]?.id ?? 0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/activity`);
      if (response.ok) setItems(((await response.json()) as { items: ActivityItem[] }).items);
    } catch {
      // The feed is informational; the next poll retries.
    }
  }, [projectId]);

  // Debounced: bursts of invoice/clock updates trigger one refetch.
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 400);
    return () => clearTimeout(timer);
  }, [refresh, changeKey]);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void refresh();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const latestId = items[0]?.id ?? 0;
  return {
    items,
    unread: latestId > seenId,
    markSeen: () => setSeenId(latestId),
  };
}
