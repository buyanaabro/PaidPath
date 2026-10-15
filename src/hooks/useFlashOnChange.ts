"use client";

import { useEffect, useRef, useState } from "react";

export type FlashTone = "good" | "bad" | "neutral";

/** Briefly highlight a KPI when its value changes. */
export function useFlashOnChange(
  value: string | number | null | undefined,
  tone: (prev: string | number, next: string | number) => FlashTone = () =>
    "neutral",
): FlashTone | null {
  const prev = useRef(value);
  const [flash, setFlash] = useState<FlashTone | null>(null);

  useEffect(() => {
    const last = prev.current;
    if (last === value || value == null || last == null) {
      prev.current = value;
      return;
    }
    setFlash(tone(last, value));
    const timer = window.setTimeout(() => setFlash(null), 600);
    prev.current = value;
    return () => window.clearTimeout(timer);
    // tone is a stable helper; including it retriggers the flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return flash;
}

export function flashClass(tone: FlashTone | null): string {
  if (!tone) return "";
  return `pp-flash-${tone}`;
}
