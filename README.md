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
- **Bryntum Gantt** loads and saves through Bryntum's CrudManager protocol
  (`/api/projects/[id]/gantt`: `GET` load, `POST` sync) backed by SQLite (Drizzle ORM).
  Edits auto-sync; client-side phantom ids are mapped to database ids server-side.
- **PayPal Agent Toolkit** tools are exposed to the AI (Vercel AI SDK v6) and called
  directly for deterministic flows.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind CSS
- Bryntum Gantt 7.3 (public npm trial package)
- SQLite (better-sqlite3) + Drizzle ORM
- PayPal Agent Toolkit + Vercel AI SDK v6 + Google Gemini (3.5 Flash, falling back to 3.8 Flash)
- Hosting: Render

## License

MIT for this repository's code. Bryntum Gantt is commercial software installed
from Bryntum's public npm trial package and is not redistributed here.
