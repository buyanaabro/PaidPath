import Image from "next/image";
import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/brand/Logo";
import DemoButton from "@/components/DemoButton";
import screens from "../../public/screens/manifest.json";

type Screen = keyof typeof screens;
const size = (name: Screen) => screens[name];

const GITHUB = "https://github.com/buyanaabro/PaidPath";

export const metadata = {
  title: "PaidPath — the project plan that reacts to money",
};

const STEPS = [
  {
    title: "A brief becomes a priced plan",
    body: "Paste the client's brief and budget. Gemini drafts phases, tasks and paid milestones whose prices add up to the budget, straight onto a Bryntum Gantt you can edit, regenerate or accept.",
    image: "plan" as Screen,
    alt: "Gantt with priced milestones and payment-gated phases",
  },
  {
    title: "Every milestone is a PayPal invoice",
    body: "Send it from the timeline. PaidPath simulates your plan first: “If the client pays within 7 days, the launch moves about 7 days earlier — suggested: 2% ($30).” The discount is real on the PayPal invoice.",
    image: "send-dialog" as Screen,
    alt: "Send invoice dialog suggesting an early-payment discount",
  },
  {
    title: "Payments move the plan",
    body: "The next phase waits until the client is expected to pay. Pay early and it pulls in; run late and it slips a day per day. Baseline, critical path and a cash curve show the impact.",
    image: "pulled-in" as Screen,
    alt: "Toast: payment received, launch pulled in",
  },
  {
    title: "Your client sees it too",
    body: "A private link shows the client their timeline, what's due with PayPal pay buttons, and “Pay today → launch moves to Nov 27”. When they pay, both views update within seconds.",
    image: "portal" as Screen,
    alt: "Client portal with pay button and launch prediction",
  },
  {
    title: "A copilot for the money side",
    body: "Ask “What if Aurora pays a week late?” or “Chase the overdue invoice”. It answers from live data, runs what-ifs on a copy of the plan, and only acts after you confirm.",
    image: "copilot" as Screen,
    alt: "Copilot chat answering a what-if question",
  },
];

const BUILT_WITH = [
  {
    name: "Bryntum Gantt",
    items: [
      "Scheduling engine + constraints for payment holds",
      "CrudManager load/sync to SQLite",
      "Baselines, critical path, indicators, time ranges",
      "AI chat panel extended with PaidPath tools",
      "Grid for the invoice ledger and activity feed",
      "Read-only Gantt in the client portal",
    ],
  },
  {
    name: "PayPal Agent Toolkit",
    items: [
      "create · send · get · QR code for invoices",
      "Payment reminders with escalating tone",
      "Record payment (sandbox) and status polling",
      "Line-item discounts, removed via invoice update",
      "Transaction search for the copilot",
    ],
  },
  {
    name: "Google Gemini",
    items: [
      "Plan architect with structured output",
      "Client-facing invoice notes",
      "Copilot tool calls (Flash-Lite first, ~1–4 s)",
      "Free-tier aware: quota routing + template fallbacks",
    ],
  },
];

export default async function Landing({ searchParams }: PageProps<"/">) {
  const limited = (await searchParams).demo === "limit";
  return (
    <div className="min-h-screen bg-[#f6f5f1] text-[#0b1f3a]">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Wordmark className="text-lg" />
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="hidden hover:underline sm:inline">
            How it works
          </a>
          <a href="#built" className="hidden hover:underline sm:inline">
            Built with
          </a>
          <a href={GITHUB} className="hidden hover:underline sm:inline">
            GitHub
          </a>
          <DemoButton className="px-4 py-2" />
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-8">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-[#3f4b5c]">For freelancers and small agencies</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              The project plan that reacts to money.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-[#3f4b5c]">
              Describe the project and AI drafts a priced, milestone-by-milestone plan on a Gantt. Every milestone is a
              PayPal invoice. When a client pays late, the next phase waits; when they pay early, the launch moves in.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <DemoButton />
              <Link
                href="/projects/new"
                className="rounded-lg border border-[#0b1f3a]/20 bg-white px-5 py-2.5 text-sm font-semibold hover:border-[#0b1f3a]/40"
              >
                Start from a client brief
              </Link>
              <a href={GITHUB} className="px-2 py-2.5 text-sm font-semibold underline-offset-4 hover:underline">
                View on GitHub
              </a>
            </div>
            <p className="mt-3 text-xs text-[#3f4b5c]">Your own copy of a demo project · PayPal sandbox · no sign-up</p>
            {limited && (
              <p role="alert" className="mt-4 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
                You&apos;ve created several demo projects in the last hour — open one from{" "}
                <Link href="/projects" className="font-semibold underline">
                  your projects
                </Link>{" "}
                or try again later.
              </p>
            )}
          </div>
          <figure className="mt-12 overflow-hidden rounded-xl border border-[#0b1f3a]/10 bg-white shadow-[0_20px_50px_-20px_rgba(11,31,58,0.35)]">
            <Image
              src="/screens/workspace.png"
              alt="PaidPath workspace: Gantt with payment holds, an invoice with an early-payment discount, and the invoice ledger"
              {...size("workspace")}
              sizes="(min-width: 1152px) 1104px, 100vw"
              priority
              className="h-auto w-full"
            />
          </figure>
        </section>

        <section id="how" className="border-t border-[#0b1f3a]/10 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-10 space-y-16">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className={`grid gap-8 lg:items-center ${index % 2 ? "lg:grid-cols-[1.7fr_1fr]" : "lg:grid-cols-[1fr_1.7fr]"}`}
                >
                  <div className={index % 2 ? "lg:order-2" : ""}>
                    <p className="text-sm font-semibold text-[#0070ba]">Step {index + 1}</p>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-3 leading-relaxed text-[#3f4b5c]">{step.body}</p>
                  </div>
                  <figure
                    className={`overflow-hidden rounded-xl border border-[#0b1f3a]/10 bg-[#f6f5f1] ${
                      size(step.image).height > size(step.image).width ? "mx-auto w-full max-w-md" : ""
                    }`}
                  >
                    <Image
                      src={`/screens/${step.image}.png`}
                      alt={step.alt}
                      {...size(step.image)}
                      sizes="(min-width: 1024px) 700px, 100vw"
                      className="h-auto w-full"
                    />
                  </figure>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="built" className="border-t border-[#0b1f3a]/10">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">Built with</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {BUILT_WITH.map((group) => (
                <div key={group.name} className="rounded-xl border border-[#0b1f3a]/10 bg-white p-5">
                  <h3 className="font-semibold">{group.name}</h3>
                  <ul className="mt-3 space-y-2 text-sm text-[#3f4b5c]">
                    {group.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#22c55e]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-12 flex flex-wrap items-center gap-4">
              <DemoButton />
              <p className="text-sm text-[#3f4b5c]">Takes about three minutes — a checklist in the demo walks you through it.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#0b1f3a]/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-[#3f4b5c]">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="h-4 w-4" /> PaidPath · built for the PayPal AI Hackathon 2026 · MIT
          </span>
          <span>PayPal sandbox only · Gemini free tier · Bryntum Gantt trial</span>
        </div>
      </footer>
    </div>
  );
}
