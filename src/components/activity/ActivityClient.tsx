"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type ActivityFeedComponent from "./ActivityFeed";

// Bryntum widgets need `window`, so the feed renders client-side only.
const ActivityFeed = dynamic(() => import("./ActivityFeed"), { ssr: false });

export default function ActivityClient(props: ComponentProps<typeof ActivityFeedComponent>) {
  return <ActivityFeed {...props} />;
}
