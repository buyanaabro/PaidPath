import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";

// 3.5 Flash is fast and reliable for our structured outputs; 3.8 Flash was frequently
// overloaded (503s / timeouts) in October 2026, so it is the fallback.
export const DEFAULT_MODEL = "gemini-3.5-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

// Each model has its own free-tier daily quota (20 requests/day in Oct 2026), so a lite
// model at the end of the chain adds headroom for the hosted demo.
export const LAST_RESORT_MODEL = "gemini-3.5-flash-lite";

/** Primary model first, then fallbacks for overload (503), quota (429) or bad output. */
export function modelChain() {
  return [
    ...new Set([
      process.env.AI_MODEL || DEFAULT_MODEL,
      process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
      LAST_RESORT_MODEL,
    ]),
  ];
}

export function getModel(modelId = modelChain()[0]) {
  return google(modelId);
}

// Low thinking keeps tool-calling turns fast; the default ("medium") can take minutes
// with large tool schemas like create_invoice.
export const modelProviderOptions = {
  google: {
    thinkingConfig: { thinkingLevel: "low" },
  } satisfies GoogleLanguageModelOptions,
};
