// Model ids shared by server code and the browser (no SDK imports here).

// 3.5 Flash is fast and reliable for our structured outputs; 3.8 Flash was frequently
// overloaded (503s / timeouts) in October 2026, so it is the fallback.
export const DEFAULT_MODEL = "gemini-3.5-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

// Each model has its own free-tier daily quota (20 requests/day in Oct 2026), so a lite
// model at the end of the chain adds headroom for the hosted demo.
export const LAST_RESORT_MODEL = "gemini-3.5-flash-lite";
