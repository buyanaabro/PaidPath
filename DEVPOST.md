# Devpost submission copy (PaidPath)

Paste these fields into
[Enter a Submission](https://paypalaihackathon.devpost.com/).
Tick **Bryntum** and **Render** if the form has sponsor-prize checkboxes.

Deadline: **Nov 12, 2026, 12:00pm PST**. Keep
https://paidpath.onrender.com reachable through judging (**Dec 1–15**).

## Project name

PaidPath

## Tagline (38 / 60 characters)

The project plan that reacts to money

## Demo URL

https://paidpath.onrender.com

Click **Try the live demo** (PayPal sandbox, no sign-up). Each visitor gets
their own copy. First load on the free Render instance can take ~30s.

## Repository

https://github.com/buyanaabro/PaidPath

MIT license (visible in GitHub About). Local run: `README.md` → Run locally
(US PayPal sandbox app with Invoicing + Transaction search, plus a Gemini key).

## Video

File (68s, desktop capture of the live product, macOS `say` voiceover, no music):

- In-repo: `public/demo/paidpath-demo.mp4`
- After Render deploys: https://paidpath.onrender.com/demo/paidpath-demo.mp4
- Regenerated with `npm run video` (needs `npm run dev` and PayPal sandbox).

**Devpost requires a public YouTube URL.** Upload that MP4 at
https://www.youtube.com/upload (title: `PaidPath — the project plan that reacts to money`,
visibility: **Public**, no copyrighted music). Paste the watch URL here:

_TBD after YouTube upload._

## Built with

PayPal Agent Toolkit, PayPal Invoicing API, Google Gemini, Vercel AI SDK,
Bryntum Gantt, Render, Next.js, TypeScript, SQLite, Drizzle ORM, Tailwind CSS

## Inspiration / the problem

Freelancers and small agencies already know two tools: a project plan, and
invoices. They do not talk to each other. A client paying late does not move
the Gantt. A client paying early (or taking a discount) does not pull the
launch in. The merchant and the client never share one picture of “when does
the work actually start?”

PaidPath treats **payment state as a scheduling input**.

## What it does

1. Describe a project. Gemini drafts a priced, milestone-by-milestone plan on
   a Bryntum Gantt (normalized so prices sum to the budget and the graph stays
   acyclic).
2. Each billable milestone is a **PayPal sandbox invoice** sent through the
   PayPal Agent Toolkit (`create_invoice` → `send_invoice` → `get_invoice` →
   QR). An AI-written client note goes on the invoice; a secret client-portal
   link is included.
3. Work that depends on a milestone cannot start until the client is expected
   to pay. Early payment pulls the next phase in. Late payment slips the plan
   a day per day. Bryntum’s scheduling engine does the reflow; a cash chart
   and header KPIs update in the same moment.
4. The send dialog simulates the plan on a headless copy of the Gantt and
   suggests a real line-item **early-payment discount**. If the window passes,
   PaidPath removes it on PayPal via `update_invoicing`.
5. The **client portal** (`/p/[token]`) is read-only: their timeline, PayPal
   pay buttons + QR, the discount, and “pay today → launch moves to …”.
6. The **Ops Copilot** (Bryntum AI chat + PaidPath tools) answers what-ifs,
   searches PayPal transactions, and — after a confirm — can send, remind, or
   record a payment.

A five-step checklist on the demo copy walks judges through the loop.

## How we built it (tech)

**PayPal (sandbox, Agent Toolkit)** — `create_invoice`, `send_invoice`,
`get_invoice`, `generate_invoice_qr_code`, `send_invoice_reminder`,
`record_payment_for_invoice`, `update_invoicing`, `list_transactions`,
`list_invoices`. PayPal’s `create_conditional_rules_for_invoice` returned
HTTP 500 in sandbox, so discounts are a line-item discount we enforce
ourselves.

**AI (Google Gemini, Vercel AI SDK v6)** — plan architect (structured output
with Flash → Flash-Lite fallback), invoice notes, Ops Copilot via a
same-origin proxy so the key never leaves the server. Quota-aware routing;
template fallbacks when the free tier is exhausted.

**Bryntum Gantt 7.3** — payment holds as tagged `startnoearlierthan`
constraints; CrudManager persistence; baselines, critical path, indicators,
task renderer, toasts; headless `ProjectModel` for what-if / discount
simulation; Grid for the invoice ledger and agent activity; read-only Gantt
on the portal; experimental AI ChatPanel with custom tools.

**Render** — `render.yaml` Blueprint, Node 22 web service, live demo at
https://paidpath.onrender.com.

## Challenges

PayPal’s native early-pay-discount API is broken in sandbox (reproduced by
`npm run smoke:discount`). Gemini free-tier quotas (~20 requests/day/model)
forced Flash-Lite-first copilot routing and deterministic simulations that
do not spend quota. Bryntum AI undo must not look like it un-sends an
invoice, so server-owned invoice state is reconciled outside the AI
transaction.

## Accomplishments

A complete merchant workspace *and* a client portal, not a chat demo glued
to one PayPal call. Payment timing and delivery timing are one picture.
The hosted demo needs no sign-up.

## What we learned

Invoicing is a scheduling problem. Once due dates, discounts, and actual
payment dates are constraints the Gantt owns, the “chase the client”
workflow becomes a what-if on a headless plan instead of a spreadsheet.

## What's next

Sign-in and durable storage (Render disk is ephemeral on the free plan).
Live PayPal webhooks instead of polling. A production Bryntum license so
the trial watermark goes away.

## Tools used (hackathon form)

| Tool | How it is used |
| --- | --- |
| PayPal Agent Toolkit (sandbox) | Milestone invoices, QR, reminders, record payment, discount removal, transaction search |
| Google Gemini | Plan architect, invoice notes, Ops Copilot |
| Vercel AI SDK v6 | Structured output + tool calling |
| Bryntum Gantt | Scheduling engine, payment gates, copilot UI, portal, ledger Grid |
| Render | Hosted demo (`render.yaml`) |
| Next.js 16 + SQLite/Drizzle | App + persistence |

## Gallery

Upload from `public/screens/` (cover first):

1. `workspace.png` — Gantt with payment holds and invoice ledger
2. `send-dialog.png` — discount simulation before send
3. `portal.png` — client view with PayPal pay button
4. `pulled-in.png` — plan after early payment
5. `copilot.png` — Ops Copilot what-if
6. `plan.png` — AI-drafted plan

## Sponsor prizes

Eligible as submitted: **Best Use of Bryntum**, **Best Use of Render**.
Do not add unused sponsor tools (AG Grid, APIMatic, Channel3, …).
