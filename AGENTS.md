<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PaidPath project notes

- Plan of record: `~/.devin/plans/plan-cf3fbd70f25ca2c1.md` (phases, acceptance criteria, decisions).
- Verify: `npm run typecheck && npm run lint && npm run build`.
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
- `zod@3` (toolkit schemas are zod v3). New deps: pick versions published ≥7 days ago.
