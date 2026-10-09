import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL, LAST_RESORT_MODEL } from "./models";

export { DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL, LAST_RESORT_MODEL };

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

/**
 * The copilot makes several short tool-calling requests per question, so latency matters
 * more than depth: Flash-Lite answered in ~1 s in testing (3.8 Flash took 20–35 s on Render).
 * It also leaves 3.5 Flash's free quota for plan generation.
 */
export function copilotModelChain() {
  return [...new Set([LAST_RESORT_MODEL, ...modelChain()])];
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
