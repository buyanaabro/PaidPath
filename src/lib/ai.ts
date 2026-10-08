import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";

// 3.5 Flash is fast and reliable for our structured outputs; 3.8 Flash was frequently
// overloaded (503s / timeouts) in October 2026, so it is the fallback.
export const DEFAULT_MODEL = "gemini-3.5-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

/** Primary model first, then a fallback for overload (503) or bad output. */
export function modelChain() {
  return [
    process.env.AI_MODEL || DEFAULT_MODEL,
    process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
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
