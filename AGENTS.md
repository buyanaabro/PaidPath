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
