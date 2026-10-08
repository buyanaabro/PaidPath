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

Requirements: Node.js 20.9+, a free [PayPal Developer](https://developer.paypal.com/)
sandbox app, and a free [Gemini API key](https://aistudio.google.com/).

```bash
npm install
cp .env.example .env.local   # fill in PayPal sandbox + Gemini credentials
npm run dev                  # http://localhost:3000
```

Smoke tests (hit the real PayPal sandbox):

```bash
npm run smoke:paypal   # creates a draft sandbox invoice via the Agent Toolkit
npm run smoke:ai       # Gemini calls a PayPal toolkit tool (list_invoices)
```

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind CSS
- Bryntum Gantt 7.3 (public npm trial package)
- PayPal Agent Toolkit + Vercel AI SDK v6 + Google Gemini 3.8 Flash
- Hosting: Render

## License

MIT for this repository's code. Bryntum Gantt is commercial software installed
from Bryntum's public npm trial package and is not redistributed here.
