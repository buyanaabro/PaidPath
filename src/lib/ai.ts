import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";

export const DEFAULT_MODEL = "gemini-3.8-flash";

export function getModel() {
  return google(process.env.AI_MODEL || DEFAULT_MODEL);
}

// Low thinking keeps tool-calling turns fast; the default ("medium") can take minutes
// with large tool schemas like create_invoice.
export const modelProviderOptions = {
  google: {
    thinkingConfig: { thinkingLevel: "low" },
  } satisfies GoogleLanguageModelOptions,
};
