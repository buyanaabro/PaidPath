<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PaidPath project notes

- Plan of record: `~/.devin/plans/plan-cf3fbd70f25ca2c1.md` (phases, acceptance criteria, decisions).
- Verify: `npm run typecheck && npm run lint && npm test && npm run build`. `typecheck` runs
  `next typegen` first (needed for `PageProps` / `RouteContext` route types).
- DB: SQLite via better-sqlite3 + Drizzle (Node ≥22). Schema `src/db/schema.ts`; after edits run
  `npm run db:generate -- --name <change>` and commit `drizzle/`. `getDb()` migrates + seeds on first use.
  Every page/route that reads the DB must `await connection()` first (sync reads are prerender-eligible).
  Reset local data: `npm run db:seed -- --reset`. Tests use `createDb(":memory:")`.
- Gantt persistence: Bryntum CrudManager at `/api/projects/[id]/gantt` (`src/server/gantt/crud.ts`).
  Real sync payloads send dependency endpoints as `from`/`fromEvent`/`fromTask` (all three), dates with
  the browser's TZ offset (stored verbatim), plus a `project` section (ignored).
- Real-browser checks: `node scripts/dev/browser-eval.mjs <url> <file.js> [waitMs]` runs JS in headless
  Brave with CDP (async; `return` a value). Get the Gantt via `bryntum.query("gantt")`. Kill stale
  browsers with `pkill -f paidpath-cdp` if it hangs.
- Smoke tests against real sandbox: `npm run smoke:paypal`, `npm run smoke:ai` (need `.env.local`).
- Render check without a GUI: run `npm run dev`, then headless Brave screenshot:
  `"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --headless=new --window-size=1440,900 --virtual-time-budget=15000 --screenshot=/tmp/shot.png http://localhost:3000`
- Bryntum: import from `@bryntum/gantt` (npm alias to the trial). Use `<BryntumGanttProjectModel ref>`
  + `<BryntumGantt project={ref}>` (see `PlanGantt.tsx`). Inline stores inside the `project` prop, or a
  `ProjectModel` instance with inline data, trigger a wrapper dev warning; `project` + `tasks` props on
  `BryntumGantt` throws. Gantt renders client-only via `next/dynamic` `ssr: false` in `GanttClient.tsx`.
- Always check the dev-server log for `[browser]` warnings/errors after Bryntum changes — a green build
  does not prove the component rendered.
- Bryntum offline docs/examples: `../reference/bryntum-gantt-7.3.7/` (outside repo, never commit).
- AI SDK: app uses `ai@6` + `@ai-sdk/google@3` (Gemini 3 tool-calling needs thought-signature support;
  AI SDK v4 fails with 400). The PayPal toolkit is built on AI SDK v4 and keeps its own nested `ai@4`;
  `getPayPalTools()` in `src/lib/paypal.ts` re-wraps its tools for v6. Use `callPayPalTool()` for
  deterministic (non-LLM) PayPal calls — it throws `PayPalToolError` on `{ ok: false }` results.
- Models: `modelChain()` = `gemini-3.5-flash` → fallback `gemini-3.8-flash` (3.8 was often 503 /
  timing out in Oct 2026). Loop over the chain with `maxRetries: 1` for user-facing calls.
- AI architect: `src/server/architect/` (schema → `normalizePlan` → `materializePlan` → `insertPlanTree`).
  `npm run eval:architect` = real Gemini regression check. Server actions in `src/app/projects/actions.ts`.
- Server actions in client components: drive disabled/busy UI with explicit state, not
  `useTransition` pending — remounting the Gantt inside a transition kept it pending for 15s+.
- Invoicing: `src/server/invoicing/` (`service.ts` takes injectable `{ callTool, draftNote, now }` deps
  for tests). `tasks.invoiceStatus` is server-owned: `persist: false` on `PaidTaskModel` and excluded from
  the CrudManager whitelist; the client mirrors it from `/api/projects/[id]/invoices` `taskStatuses`.
  PayPal facts: create_invoice has no due date (we store `dueAt` = sent + 14d); the QR tool returns a
  multipart body (`extractQrPng`); `record_payment_for_invoice` → `MARKED_AS_PAID`.
- Bryntum 7 menus use `.b-menu-item`; menus ignore synthetic DOM events — in CDP tests use the
  `__cdpInput` binding (trusted mouse input) and scroll the task into view first (the ledger panel can
  cover it). Renderers that return HTML need `htmlEncode: false` on the column.
- React Compiler lint (`react-hooks/*`) is strict: no setState in effects (pass initial data from the
  server page instead), no `Date.now()` in render (compute on the server), no ref access while building
  Bryntum configs (one justified disable in `PlanGantt.tsx`).
- Payment gates: rule in `src/lib/gates.ts` (pure, date-only `YYYY-MM-DD`); applied client-side in
  `src/components/gantt/payment-gates.ts` (`applyPaymentGates` iterates gates in schedule order with
  `commitAsync` between passes). Holds are `startnoearlierthan` constraints tagged by `tasks.gateHold`
  (only tagged constraints are ever released). `PlanGantt` serializes all reconciliation through a
  promise queue (`reconcile`). Project clock: `src/server/clock.ts` (`projectToday/projectNow`); invoice
  dates use it, but PayPal API fields (`invoice_date`, `payment_date`) always get the real date.
- Bryntum 7 class names: `.b-sch-time-range` (time ranges), `.b-menu-item`, `.b-slide-toggle`.
  Bryntum renders indicators mid-recalculation — guard against undefined task dates in renderers.
  The time-range store is removed from CrudManager (`removeCrudStore("timeRanges")`) — Today line is local.
- TimelineChart (S-curve) was spiked and rejected for cash: it only calls series callbacks for leaf
  tasks during their working days (never milestones / payment gaps) and only draws if enabled at
  construction. Cash chart is `src/components/invoices/CashChart.tsx` (series in `src/lib/cashflow.ts`).
- Gemini free tier = ~20 requests/day **per model**; `modelChain()` ends with `gemini-3.5-flash-lite`.
  Real-API scripts (`eval:architect`, `smoke:*`) burn quota — run sparingly.
- Screenshots: use `SCREENSHOT=/tmp/x.png WINDOW_SIZE=1440,1000 node scripts/dev/browser-eval.mjs …`
  (CDP capture). Plain `--headless --screenshot --virtual-time-budget` can hang on this app.
- `logAgentRun` swallows its own errors (audit logging must never break the action).
- A long-running `npm run dev` keeps its DB connection from before new migrations — restart dev after
  `db:generate` (fresh processes, e.g. Render deploys, migrate automatically).
- In CDP tests use `bryntum.queryAll("gantt").filter(g => !g.isDestroyed)` — after a remount
  `bryntum.query` can return the destroyed instance.
- Always pass `providerOptions: modelProviderOptions` (Gemini thinkingLevel "low"); the default
  "medium" thinking stalled tool-calling turns for minutes.
- PayPal sandbox: the seller app must belong to a **US** sandbox business account — the HU account
  could not get the Invoicing scope. Check scopes: request a client_credentials token and look for
  `services/invoicing` and `services/reporting` in `scope`.
- `zod@3` (toolkit schemas are zod v3). New deps: pick versions published ≥7 days ago.
- Ops Copilot = Bryntum `features.ai` (experimental in 7.3) + `GooglePlugin`, configured in `PlanGantt.tsx`
  (`aiFeature`), custom tools in `src/components/copilot/tools.ts` (`AIHelper.createBasicTool`, write
  tools confirm with `MessageDialog.confirm` and send `x-paidpath-actor: copilot`). Server half:
  `POST /api/ai/prompt?projectId=` → `src/server/copilot/proxy.ts` (same-origin, model allowlist, strips
  Bryntum's `model` field, appends `buildCopilotContext()` to `systemInstruction`, forces thinking low,
  `QuotaRouter` per model/day + `RateLimiter` per IP). User-facing failures are returned as a normal
  model text reply (`notice()`) — GooglePlugin throws on non-OK and only shows "(failed)".
- Bryntum AI gotchas (7.3.7): `tools: { name: null }` (documented removal) crashes `toolsDescription`;
  `planning: true` costs ~3 extra requests per multi-part question (disabled); default prompt `timeout`
  60s includes time spent in our confirm dialogs (set 180s); `mentions: false` swaps the input to a
  `<textarea>` (with mentions it's a contenteditable); built-in updates confirm **inline**
  (`.b-approve-button` / `.b-reject-button`), our dialogs are `.b-message-dialog`; undo = `.b-icon-undo`
  bubble tool; English locale lacks `ChatPanel.undoTooltip` (patched via `LocaleHelper.publishLocale`).
  Tool names come from the task model `$name` ("Task" → `getTasks`, `updateTasks`).
- Server-owned state applied during an AI turn would be recorded in the AI's undo transaction
  (project STM) — `reconcile` waits for `afterAiTransaction()` so "Undo" never appears to un-send an
  invoice.
- Gemini 3 only validates thought signatures within the current turn: the proxy may switch model when
  the last message is new user text (it strips old `thoughtSignature`s), never mid tool-loop.
- Copilot E2E without quota: run dev with `COPILOT_MODE=record` once (real Gemini, saves
  `fixtures/copilot.json`), then `COPILOT_MODE=replay` (keys = user text + call names/args, so replays
  of id-specific args like invoice numbers depend on data). Chat driver pattern: open `.b-chat-button`,
  focus `chatPanel.widgetMap.messageField` textarea, `__cdpInput({ text })` + `{ key: "Enter" }`.
  `__cdpInput({ move: true, x, y })` hovers (tooltips).
- PayPal `get_merchant_insights` throws in sandbox; `list_transactions` works (31-day max range).
- Agent log actors: `architect`, `copilot`, `automation` (PayPal polling), `user` (UI clicks). The
  Agent activity tab reads `/api/projects/[id]/activity` (`src/server/activity.ts` summaries).
- Early-payment discounts (Phase 6): PayPal's `create_conditional_rules_for_invoice` returns **500 in
  sandbox** (any terms/condition) and the inline `payment_term.conditional_rules` field is dropped.
  PaidPath uses a **line-item discount** (`buildInvoicePayload({ discountPercent })`) and removes it with
  `update_invoicing` (full replacement, same payload, original `invoice_date`) when the project's today
  passes `invoices.discountUntil` — `expireDiscounts()` runs on refresh polls and clock changes.
  Toolkit actions enabled: `invoices.update`. `recordDemoPayment` pays PayPal's current `due_amount`.
  Shared pure logic: `src/lib/discount.ts` (offer validation, `discountView` states, `suggestDiscount`,
  `suggestedWindow` < terms). `npm run smoke:discount` reproduces the PayPal behaviour.
- Headless what-if simulations: `src/components/gantt/simulate.ts` (`simulatePayments`, `discountBenefit`;
  serialized). Used by the send dialog (via `PlanGantt` `onReady` → `GanttApi`), copilot tools and portal.
- `PlanGantt` effects: options/props sync runs on every change, but `reconcile()` only on data deps
  (`taskStatuses`, `gate`, `canInvoice`) — re-running it for callback identity changes fed a render loop
  that froze the page once the send dialog opened.
- Client portal: `/p/[token]` (`src/app/p`, `src/components/portal/`), token helpers `src/server/portal.ts`
  (32-char base64url, `projects.share_token`, rotate via `POST /api/projects/[id]/share {rotate:true}`),
  snapshot `src/server/portal-snapshot.ts` (client-safe fields only; PayPal refresh throttled 15 s),
  read-only CrudManager load at `/api/portal/[token]/gantt` (no POST). Portal applies payment gates in
  memory (never synced). Visits log `actor: "client"`, `portal_viewed`, ≤ 1/hour.
- Copilot model order: `copilotModelChain()` = flash-lite → 3.5-flash → 3.8-flash (1–4 s/request on
  lite); plan architect / invoice notes keep `modelChain()`.
- Flex gotcha: in a column flex layout `flex-1` overrides an explicit `h-[..]` (basis 0) — the portal
  Gantt uses `flex-none` + height on mobile, `lg:flex-1` on desktop.
