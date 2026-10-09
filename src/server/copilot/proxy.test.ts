import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { agentLog, invoices, tasks } from "@/db/schema";
import { seedDemoProject } from "@/db/seed";
import { buildCopilotContext } from "./context";
import { pacificDay, QuotaRouter, RateLimiter } from "./limits";
import { handlePrompt, MAX_BODY_BYTES, MESSAGES, type PromptDeps, type PromptRequest } from "./proxy";
import { conversationKey, FixtureStore } from "./replay";

const MODELS = ["m-primary", "m-fallback", "m-lite"];
const NOW = new Date("2026-11-20T18:00:00Z");

let db: Db;
let projectId: number;
let calls: { url: string; body: Record<string, unknown> }[];
let replies: (() => Response)[];

const ok = (text = "Hi") => () =>
  Response.json({ candidates: [{ content: { role: "model", parts: [{ text }] } }], usageMetadata: { totalTokenCount: 9 } });
const status = (code: number, message = "") => () => Response.json({ error: { code, message } }, { status: code });
const replyText = (json: unknown) =>
  (json as { candidates: { content: { parts: { text: string }[] } }[] }).candidates[0].content.parts[0].text;

function deps(overrides: Partial<PromptDeps> = {}): PromptDeps {
  return {
    db,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return (replies.shift() ?? ok())();
    }) as typeof fetch,
    now: () => NOW,
    apiKey: "test-key",
    allowedModels: MODELS,
    quota: new QuotaRouter(MODELS, 5),
    limiter: new RateLimiter(100, 60_000),
    mode: "live",
    fixtures: new FixtureStore(join(mkdtempSync(join(tmpdir(), "pp-fixtures-")), "copilot.json")),
    ...overrides,
  };
}

const userTurn = { role: "user", parts: [{ text: "What's outstanding?" }] };
const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    model: "m-primary",
    contents: [userTurn],
    systemInstruction: { parts: [{ text: "Bryntum system prompt" }] },
    generationConfig: { temperature: 0 },
    tools: [{ functionDeclarations: [] }],
    ...extra,
  });
const request = (overrides: Partial<PromptRequest> = {}): PromptRequest => ({
  projectId,
  visitor: "1.2.3.4",
  origin: "https://paidpath.test",
  host: "paidpath.test",
  secFetchSite: "same-origin",
  rawBody: body(),
  ...overrides,
});

beforeEach(() => {
  db = createDb(":memory:");
  projectId = seedDemoProject(db);
  calls = [];
  replies = [];
});

describe("handlePrompt", () => {
  test("forwards to Gemini without the model field, with low thinking and PaidPath context", async () => {
    const result = await handlePrompt(request(), deps());
    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/models\/m-primary:generateContent$/);
    const sent = calls[0].body as {
      model?: string;
      generationConfig: Record<string, unknown>;
      systemInstruction: { parts: { text: string }[] };
      tools: unknown;
    };
    assert.equal(sent.model, undefined);
    assert.deepEqual(sent.generationConfig, { temperature: 0, thinkingConfig: { thinkingLevel: "low" } });
    assert.equal(sent.systemInstruction.parts[0].text, "Bryntum system prompt");
    assert.match(sent.systemInstruction.parts[1].text, /PaidPath context/);
    assert.ok(sent.tools);
    const log = db.select().from(agentLog).all().at(-1)!;
    assert.equal(log.actor, "copilot");
    assert.equal(log.action, "copilot_turn");
    assert.equal(log.ok, true);
  });

  test("rejects cross-origin, oversized, malformed and unknown-model requests", async () => {
    assert.equal((await handlePrompt(request({ origin: "https://evil.test" }), deps())).status, 403);
    assert.equal((await handlePrompt(request({ origin: null, secFetchSite: "cross-site" }), deps())).status, 403);
    assert.equal((await handlePrompt(request({ origin: null, secFetchSite: "same-origin" }), deps())).status, 200);
    assert.equal(replyText((await handlePrompt(request({ rawBody: "x".repeat(MAX_BODY_BYTES + 1) }), deps())).json), MESSAGES.tooLong);
    assert.equal((await handlePrompt(request({ rawBody: "{nope" }), deps())).status, 400);
    assert.equal((await handlePrompt(request({ rawBody: body({ contents: [] }) }), deps())).status, 400);
    assert.equal((await handlePrompt(request({ rawBody: body({ model: "gpt-5" }) }), deps())).status, 400);
    assert.equal((await handlePrompt(request({ projectId: 999 }), deps())).status, 404);
    assert.equal(calls.length, 1);
  });

  test("rate-limits a visitor with a friendly in-chat reply", async () => {
    const shared = deps({ limiter: new RateLimiter(2, 60_000) });
    await handlePrompt(request(), shared);
    await handlePrompt(request(), shared);
    const third = await handlePrompt(request(), shared);
    assert.equal(third.status, 200);
    assert.equal(replyText(third.json), MESSAGES.busy);
    assert.equal(calls.length, 2);
    assert.equal((await handlePrompt(request({ visitor: "5.6.7.8" }), shared)).status, 200);
  });

  test("falls back to the next model on 429/503 when the user starts a turn", async () => {
    const shared = deps();
    replies = [status(429, "Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier"), status(503), ok()];
    assert.equal((await handlePrompt(request(), shared)).status, 200);
    assert.deepEqual(
      calls.map((c) => c.url.match(/models\/([^:]+)/)![1]),
      ["m-primary", "m-fallback", "m-lite"],
    );
    // m-primary is exhausted for the day; new conversations skip it.
    calls = [];
    await handlePrompt(request({ visitor: "9.9.9.9" }), shared);
    assert.match(calls[0].url, /m-fallback/);
  });

  test("never switches model in the middle of a tool-calling turn", async () => {
    const shared = deps();
    await handlePrompt(request(), shared); // pins m-primary
    calls = [];
    replies = [status(503)];
    const midTurn = body({
      contents: [
        userTurn,
        { role: "model", parts: [{ functionCall: { name: "listInvoices", args: {} }, thoughtSignature: "sig" }] },
        { role: "user", parts: [{ functionResponse: { name: "listInvoices", response: {} } }] },
      ],
    });
    const result = await handlePrompt(request({ rawBody: midTurn }), shared);
    assert.equal(replyText(result.json), MESSAGES.unavailable);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /m-primary/);
  });

  test("moves a conversation to another model on the next user message, without old signatures", async () => {
    const shared = deps();
    await handlePrompt(request(), shared); // pins m-primary
    shared.quota.markExhausted("m-primary", NOW);
    calls = [];
    const nextTurn = body({
      contents: [
        userTurn,
        { role: "model", parts: [{ text: "You have $2,500 outstanding.", thoughtSignature: "sig-primary" }] },
        { role: "user", parts: [{ text: "And when is it due?" }] },
      ],
    });
    assert.equal((await handlePrompt(request({ rawBody: nextTurn }), shared)).status, 200);
    assert.match(calls[0].url, /m-fallback/);
    assert.doesNotMatch(JSON.stringify(calls[0].body.contents), /thoughtSignature/);
  });

  test("a per-minute 429 only cools the model down briefly", () => {
    const router = new QuotaRouter(["a"], 10);
    router.markExhausted("a", NOW, 60_000);
    assert.equal(router.available("a", NOW), false);
    assert.equal(router.available("a", new Date(NOW.getTime() + 61_000)), true);
  });

  test("reports exhausted quota when every model is used up", async () => {
    const shared = deps({ quota: new QuotaRouter(MODELS, 1) });
    for (let i = 0; i < 3; i++) await handlePrompt(request({ visitor: `v${i}` }), shared);
    const result = await handlePrompt(request(), shared);
    assert.equal(replyText(result.json), MESSAGES.exhausted);
    assert.equal(calls.length, 3);
  });

  test("records responses and replays them without calling Gemini", async () => {
    const fixtures = new FixtureStore(join(mkdtempSync(join(tmpdir(), "pp-fixtures-")), "c.json"));
    replies = [ok("Recorded answer")];
    await handlePrompt(request(), deps({ mode: "record", fixtures }));
    calls = [];
    const replayed = await handlePrompt(request(), deps({ mode: "replay", fixtures, apiKey: undefined }));
    assert.equal(replayed.status, 200);
    assert.match(JSON.stringify(replayed.json), /Recorded answer/);
    assert.equal(calls.length, 0);
    const missing = await handlePrompt(
      request({ rawBody: body({ contents: [{ role: "user", parts: [{ text: "new" }] }] }) }),
      deps({ mode: "replay", fixtures }),
    );
    assert.equal(replyText(missing.json), MESSAGES.noFixture);
  });
});

describe("conversationKey", () => {
  test("ignores function payloads and thoughts but not user text or call args", () => {
    const a = conversationKey([
      userTurn,
      { role: "model", parts: [{ text: "thinking", thought: true }, { functionCall: { name: "listInvoices", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "listInvoices", response: { today: "2026-11-01" } } as never }] },
    ]);
    const b = conversationKey([
      userTurn,
      { role: "model", parts: [{ functionCall: { name: "listInvoices", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "listInvoices", response: { today: "2026-12-24" } } as never }] },
    ]);
    assert.equal(a, b);
    assert.notEqual(conversationKey([userTurn]), conversationKey([{ role: "user", parts: [{ text: "Other" }] }]));
  });
});

describe("QuotaRouter", () => {
  test("caps each model per Pacific day and resets at Pacific midnight", () => {
    const router = new QuotaRouter(["a", "b"], 2);
    const lateEvening = new Date("2026-11-21T07:30:00Z"); // 23:30 Pacific, Nov 20
    router.recordSuccess("a", lateEvening);
    router.recordSuccess("a", lateEvening);
    assert.equal(router.pick(lateEvening), "b");
    router.markExhausted("b", lateEvening);
    assert.equal(router.pick(lateEvening), null);
    const nextPacificDay = new Date("2026-11-21T08:30:00Z"); // 00:30 Pacific, Nov 21
    assert.equal(pacificDay(nextPacificDay), "2026-11-21");
    assert.equal(router.pick(nextPacificDay), "a");
  });
});

describe("buildCopilotContext", () => {
  test("summarizes money, invoices, holds and schedule from the database", () => {
    const milestone = db.select().from(tasks).where(eq(tasks.name, "Milestone: Designs signed off")).get()!;
    db.insert(invoices)
      .values({
        projectId,
        taskId: milestone.id,
        paypalInvoiceId: "INV2-TEST",
        invoiceNumber: "0042",
        milestoneName: milestone.name,
        amountCents: 250_000,
        paypalStatus: "SENT",
        status: "sent",
        sentAt: "2026-11-01T12:00:00.000Z",
        dueAt: "2026-11-15T12:00:00.000Z",
      })
      .run();
    const text = buildCopilotContext(db, projectId, NOW)!;
    assert.match(text, /Today is 2026-11-20\. Payment terms: 14 days\./);
    assert.match(text, /outstanding \(invoiced, unpaid\) \$2,500, of which \$2,500 overdue/);
    assert.match(text, /Invoice #0042 "Designs signed off" \$2,500 — sent 2026-11-01, OVERDUE by 5 days \(due 2026-11-15\), reminders sent: 0/);
    assert.match(text, /Milestones not invoiced yet:\n- "Direction approved" \$1,500/);
    assert.match(text, /- "Direction approved" gates "Wireframes"/);
    assert.match(text, /- "Designs signed off" gates "Frontend build"/);
    assert.equal(buildCopilotContext(db, 999), null);
  });
});
