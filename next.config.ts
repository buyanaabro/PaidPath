import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `HIDE_DEV_INDICATOR=1 npm run dev` for clean screenshots (scripts/dev/capture-screens.mjs).
  ...(process.env.HIDE_DEV_INDICATOR ? { devIndicators: false as const } : {}),
};

export default nextConfig;
