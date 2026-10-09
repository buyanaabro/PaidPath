# PaidPath

**The project plan that reacts to money.**

PaidPath is an AI project-to-cash workspace for freelancers and small agencies.
An AI architect turns a client brief into a priced, milestone-based plan on a
[Bryntum Gantt](https://bryntum.com/products/gantt/); each milestone is billed
through **PayPal invoices** via the
[PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit). Unpaid invoices
gate downstream work — the critical path and cashflow projection react live, and
the plan recovers the moment a payment lands.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (2026).
> Status: early development.

## Quick start

Requirements: Node.js 22+, a free [PayPal Developer](https://developer.paypal.com/)
sandbox app, and a free [Gemini API key](https://aistudio.google.com/).

PayPal sandbox setup: create a **US** sandbox business account, create a REST app owned
by it, and enable the app's **Invoicing** and **Transaction search** features. Use the
default sandbox *personal* account's email as `PAYPAL_SANDBOX_BUYER_EMAIL`.

```bash
npm install
cp .env.example .env.local   # fill in PayPal sandbox + Gemini credentials
npm run dev                  # http://localhost:3000
```

The SQLite database (`data/paidpath.db`) is created, migrated and seeded with a demo
project automatically on first start. Reset it with `npm run db:seed -- --reset`.

The hosted demo shares one free Gemini quota across all visitors, so the copilot may be
out of quota for the day. Running locally with your own free key takes a minute.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm test` | Unit tests (Node test runner, in-memory SQLite) |
| `npm run typecheck`, `npm run lint` | Type and lint checks |
| `npm run db:seed [-- --reset]` | Seed the demo project (optionally wiping all data first) |
| `npm run db:generate` | Generate a Drizzle migration after editing `src/db/schema.ts` |
| `npm run smoke:paypal` | Creates a draft invoice in the PayPal sandbox via the Agent Toolkit |
| `npm run smoke:ai` | Gemini calls a PayPal toolkit tool (`list_invoices`) |
| `npm run smoke:invoice-flow` | Full sandbox invoice lifecycle: create → send → QR → reminder → record payment → PAID |
| `npm run smoke:discount` | Early-payment discount in the sandbox: discounted invoice → paid in window; and expiry (discount removed via update) |
| `npm run eval:architect` | Runs 3 sample briefs through the AI architect and checks plan invariants |

## Deploy (Render)

`render.yaml` defines a free Render web service. In the Render dashboard choose
**New → Blueprint**, connect this repository and fill in the four secret environment
variables. The free instance's disk is ephemeral, so the hosted demo data resets to
the seeded demo whenever the instance restarts.

## How it works

- **AI Plan Architect** — `/projects/new` takes a client brief, budget and start date.
  Gemini returns a structured plan (`generateText` + `Output.object`), which is
  normalized server-side (acyclic dependencies, bounded durations, milestone amounts
  that sum exactly to the budget) and opened on the Gantt as an *AI draft*. You can
  edit it, regenerate it with feedback ("shorter discovery, add training"), or accept it.
  Every milestone except the last is a payment gate for the next phase.
- **PayPal invoicing loop** — every priced milestone can be invoiced from the Gantt
  (Invoice column button or the task context menu). PaidPath drafts a client note with
  Gemini (template fallback), then uses the PayPal Agent Toolkit to `create_invoice`,
  `send_invoice`, `get_invoice` and `generate_invoice_qr_code`. Milestone diamonds turn
  grey → blue (awaiting payment) → green (paid). The invoice ledger (Bryntum Grid) under
  the timeline offers the client pay page, the PayPal QR code, `send_invoice_reminder`,
  and a sandbox-only "Record payment" (`record_payment_for_invoice`). Open invoices are
  polled every 15s, so a client paying on PayPal shows up without a reload.
- **Payment-gated dependencies** — every billable milestone (except the last) is a
  payment gate: the next phase can't start before the client is expected to pay
  (milestone date + payment terms → the invoice's due date → today while overdue → the
  actual PayPal payment date). PaidPath writes these as `startnoearlierthan` constraints
  and lets Bryntum's scheduling engine reflow the plan, so paying early pulls the launch
  in and paying late pushes it out (with a Bryntum toast). Held tasks are hatched with a
  lock and a "waiting for payment" indicator; overdue milestones turn red. A baseline is
  captured when the plan is accepted, the header shows projected finish vs baseline, the
  toolbar toggles critical path / baseline, and a cash chart compares baseline, projected
  and received cash. A per-project **demo clock** (header) fast-forwards time.
- **Early-payment discounts** — "Send invoice" opens a dialog that simulates the plan:
  *"If the client pays within 7 days, the launch moves about 7 days earlier. Suggested: 2% ($50)."*
  The discount is a real reduction on the PayPal invoice (line-item discount, with the terms in
  the note); paying inside the window settles the invoice at the discounted amount, and when the
  window passes unpaid PaidPath removes the discount with PayPal's `update_invoicing` (the client
  is notified). PayPal's dedicated conditional-rules endpoint returned 500 in sandbox, so PaidPath
  enforces the window itself. Payment gates stay conservative (the plan waits for the due date)
  and pull in when the client actually pays early.
- **Client portal** — "Client view" gives each project a secret, read-only link (`/p/<token>`,
  rotatable) that is also added to every invoice note. The client sees a read-only Bryntum Gantt
  with payment holds explained in plain language, what's due with PayPal pay buttons and QR codes,
  active discounts, and *"Pay today → launch moves to Nov 27 (instead of Dec 11)"*, simulated on
  a copy of their timeline. When a payment lands the portal reflows with "Thank you! Your launch
  moved 14 days earlier", and the owner's Agent activity shows "Client opened the project portal"
  (at most hourly). No write routes; the merchant link, notes and emails are never exposed.
- **Ops Copilot** — the chat button on the Gantt opens **Bryntum's own AI chat panel**
  (`features.ai` + `GooglePlugin`), extended with PaidPath tools. Every request goes
  through `/api/ai/prompt`, which adds the Gemini key server-side and a live project
  snapshot (money, invoices, payment gates, demo clock), so "what's outstanding / when do
  I get paid?" is answered in a single model call. Custom tools:
  `whatIfPaymentDelay` (re-runs the payment gates on a headless copy of the plan),
  `getPayPalActivity` (PayPal Transaction Search), `suggestEarlyPaymentDiscount`, and the
  write actions `sendInvoice` (optionally with an early-payment discount),
  `sendReminder` (the copilot writes a reminder whose tone escalates with each one),
  `recordPayment` and `moveDemoClock`. Each write action asks for confirmation in a
  dialog first. Bryntum's built-in tools edit the plan with inline approve/reject and undo.
  The **Agent activity** tab lists every AI architect, copilot, PayPal and clock action
  with who did it.
- **Free-tier friendly** — the proxy routes copilot requests across the Gemini models by
  remaining daily quota (`gemini-3.5-flash-lite` first — about 1–4 s per request — then
  `3.5-flash` → `3.8-flash`), only switches model between user turns (Gemini 3 thought signatures are model-specific), rate-limits
  visitors, and answers in-chat ("out of free AI quota for today") instead of failing.
  Everything else keeps working without AI (template plans and invoice notes).
  `COPILOT_MODE=record|replay` saves and replays real Gemini responses
  (`fixtures/copilot.json`) for repeatable browser tests without spending quota.
- **Bryntum Gantt** loads and saves through Bryntum's CrudManager protocol
  (`/api/projects/[id]/gantt`: `GET` load, `POST` sync) backed by SQLite (Drizzle ORM).
  Edits auto-sync; client-side phantom ids are mapped to database ids server-side.
- **PayPal Agent Toolkit** tools are exposed to the AI (Vercel AI SDK v6) and called
  directly for deterministic flows.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind CSS
- Bryntum Gantt 7.3 (public npm trial package)
- SQLite (better-sqlite3) + Drizzle ORM
- PayPal Agent Toolkit + Vercel AI SDK v6 + Google Gemini (3.5 Flash → 3.8 Flash → 3.5 Flash-Lite)
- Bryntum AI feature (chat panel + agent) for the Ops Copilot
- Hosting: Render

## License

MIT for this repository's code. Bryntum Gantt is commercial software installed
from Bryntum's public npm trial package and is not redistributed here.
