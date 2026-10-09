import type { Db } from "@/db/client";
import { logAgentRun } from "@/server/projects";
import { buildCopilotContext } from "./context";
import type { QuotaRouter, RateLimiter } from "./limits";
import { conversationKey, type FixtureStore, type GeminiContent } from "./replay";

export const MAX_BODY_BYTES = 512 * 1024;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export type CopilotMode = "live" | "record" | "replay";

export type PromptDeps = {
  db: Db;
  fetch: typeof fetch;
  now: () => Date;
  apiKey: string | undefined;
  allowedModels: string[];
  quota: QuotaRouter;
  limiter: RateLimiter;
  mode: CopilotMode;
  fixtures: FixtureStore;
  timeoutMs?: number;
};

export type PromptRequest = {
  projectId: number;
  /** Visitor identity for rate limits (client IP). */
  visitor: string;
  origin: string | null;
  host: string | null;
  secFetchSite: string | null;
  rawBody: string;
};

type Result = { status: number; json: unknown };

// Hard failures (bad or foreign requests) — Gemini-shaped error body.
const error = (status: number, message: string): Result => ({
  status,
  json: { error: { code: status, message, status: "PAIDPATH_COPILOT" } },
});

/**
 * User-facing problems (quota, busy model) are returned as a normal model reply: Bryntum's
 * GooglePlugin throws on non-OK responses and would only show "(failed)" in the chat.
 */
export const notice = (message: string): Result => ({
  status: 200,
  json: { candidates: [{ content: { role: "model", parts: [{ text: message }] }, finishReason: "STOP" }], paidpathNotice: true },
});

/** True when the last message is the user's new text (not a tool result mid-turn). */
const startsTurn = (contents: GeminiContent[]) => {
  const last = contents.at(-1);
  return last?.role !== "model" && Boolean(last?.parts?.some((p) => p.text)) && !last?.parts?.some((p) => p.functionResponse);
};

/** Thought signatures are model-specific; drop them when a conversation moves to another model. */
const stripSignatures = (contents: GeminiContent[]) =>
  contents.map((c) => ({
    ...c,
    parts: c.parts?.map((part) => {
      const copy = { ...part };
      delete copy.thoughtSignature;
      return copy;
    }),
  }));

/** Daily quota vs per-minute rate limit, from Gemini's 429 body. */
const isDailyQuota = (body: string) => /PerDay|per day|daily/i.test(body);

export const MESSAGES = {
  forbidden: "Copilot requests must come from the PaidPath app.",
  busy: "You're sending messages quickly — the free AI quota is shared, so please wait a few minutes and try again.",
  exhausted:
    "PaidPath Copilot is out of free AI quota for today (it resets at midnight Pacific). Everything else — invoices, payment gates, the timeline — still works.",
  unavailable: "The AI model is busy right now. Please try again in a moment.",
  noFixture: "No recorded copilot response for this conversation (replay mode).",
  tooLong: "This conversation is getting long — clear the chat (trash icon) to start a fresh one.",
};

function sameOrigin({ origin, host, secFetchSite }: PromptRequest) {
  if (!host) return false;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return secFetchSite === "same-origin";
}

type GeminiBody = {
  model?: unknown;
  contents?: GeminiContent[];
  systemInstruction?: { parts?: { text?: string }[] };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

function functionCalls(json: unknown) {
  const parts = (json as { candidates?: { content?: GeminiContent }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts.flatMap((p) => (p.functionCall ? [p.functionCall.name] : []));
}

/**
 * Server half of Bryntum's AI feature: validates the browser's Gemini request, injects the
 * PaidPath context, routes it to a model with free-tier quota left, and adds the API key.
 */
export async function handlePrompt(req: PromptRequest, deps: PromptDeps): Promise<Result> {
  if (!sameOrigin(req)) return error(403, MESSAGES.forbidden);
  if (Buffer.byteLength(req.rawBody) > MAX_BODY_BYTES) return notice(MESSAGES.tooLong);

  let body: GeminiBody;
  try {
    body = JSON.parse(req.rawBody) as GeminiBody;
  } catch {
    return error(400, "Invalid request.");
  }
  if (!Array.isArray(body.contents) || body.contents.length === 0) return error(400, "Invalid request.");
  if (typeof body.model !== "string" || !deps.allowedModels.includes(body.model)) {
    return error(400, "Unknown model.");
  }
  const context = buildCopilotContext(deps.db, req.projectId, deps.now());
  if (!context) return error(404, "Project not found.");
  if (!deps.limiter.take(req.visitor, deps.now().getTime())) return notice(MESSAGES.busy);

  // Bryntum adds `model` to the body; Gemini takes it from the URL instead.
  const forward: GeminiBody = {
    ...body,
    systemInstruction: { parts: [...(body.systemInstruction?.parts ?? []), { text: context }] },
    // Low thinking keeps tool turns fast (default "medium" stalled for minutes).
    generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: "low" } },
  };
  delete forward.model;
  const key = conversationKey(body.contents);
  const started = deps.now().getTime();
  const log = (model: string | null, ok: boolean, extra: Record<string, unknown>) =>
    logAgentRun(deps.db, {
      projectId: req.projectId,
      actor: "copilot",
      action: "copilot_turn",
      payload: { model, messages: body.contents!.length, mode: deps.mode },
      result: extra,
      durationMs: deps.now().getTime() - started,
      ok,
    });

  if (deps.mode === "replay") {
    const recorded = deps.fixtures.get(key);
    if (!recorded) return notice(MESSAGES.noFixture);
    log("replay", true, { calls: functionCalls(recorded) });
    return { status: 200, json: recorded };
  }
  if (!deps.apiKey) return error(503, "The copilot is not configured (missing Gemini API key).");

  const pinKey = `${req.visitor}:${req.projectId}`;
  // Gemini 3 validates thought signatures only within the current turn, so a conversation
  // may change model when the user sends a new message — never in the middle of tool calls.
  const canSwitch = startsTurn(body.contents);
  const pinned = deps.quota.pinned(pinKey, deps.now());
  const tried: string[] = [];
  let model =
    pinned && (!canSwitch || deps.quota.available(pinned, deps.now())) ? pinned : deps.quota.pick(deps.now());

  while (model) {
    tried.push(model);
    deps.quota.pin(pinKey, model, deps.now());
    const payload = pinned && model !== pinned ? { ...forward, contents: stripSignatures(body.contents) } : forward;
    let response: Response;
    try {
      response = await deps.fetch(`${GEMINI_URL}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": deps.apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(deps.timeoutMs ?? 45_000),
      });
    } catch (cause) {
      log(model, false, { error: String(cause) });
      return notice(MESSAGES.unavailable);
    }
    const text = await response.text();
    if (response.ok) {
      deps.quota.recordSuccess(model, deps.now());
      const json = JSON.parse(text) as { usageMetadata?: unknown };
      if (deps.mode === "record") deps.fixtures.put(key, json);
      log(model, true, { calls: functionCalls(json), usage: json.usageMetadata });
      return { status: 200, json };
    }
    if (response.status === 429) deps.quota.markExhausted(model, deps.now(), isDailyQuota(text) ? undefined : 60_000);
    log(model, false, { status: response.status, error: text.slice(0, 300) });
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || !canSwitch) return notice(response.status === 429 ? MESSAGES.exhausted : MESSAGES.unavailable);
    model = deps.quota.pick(deps.now(), tried);
  }
  return notice(MESSAGES.exhausted);
}
