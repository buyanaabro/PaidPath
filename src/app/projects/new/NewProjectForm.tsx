"use client";

import { useActionState, useEffect, useState } from "react";
import { createProjectFromBrief, type BriefFormState } from "../actions";
import Button from "@/components/ui/Button";

const EXAMPLES = [
  {
    label: "Coffee brand site",
    clientName: "Aurora Coffee",
    budget: "7000",
    brief:
      "Specialty coffee roaster needs a new brand website with an online shop for beans and subscriptions, a story page about their farms, and launch-ready SEO.",
  },
  {
    label: "Fitness app MVP",
    clientName: "FitLoop",
    budget: "18000",
    brief:
      "MVP mobile app for booking local fitness classes: class discovery map, booking and payments, push reminders, and a simple studio admin dashboard.",
  },
];

const STAGES = [
  "Reading the brief…",
  "Sizing phases…",
  "Pricing milestones…",
];

type Props = { defaults: { clientEmail: string; startDate: string } };

export default function NewProjectForm({ defaults }: Props) {
  const [state, formAction, pending] = useActionState<BriefFormState, FormData>(
    createProjectFromBrief,
    {},
  );
  const [values, setValues] = useState({
    name: "",
    clientName: "",
    clientEmail: defaults.clientEmail,
    budget: "",
    startDate: defaults.startDate,
    paymentTermsDays: "14",
    brief: "",
  });
  const [stage, setStage] = useState(0);
  const set = (field: keyof typeof values) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setValues((v) => ({ ...v, [field]: event.target.value }));
  const fieldError = (field: string) => state.fieldErrors?.[field];

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      4000,
    );
    return () => window.clearInterval(timer);
  }, [pending]);

  const field = (name: keyof typeof values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input
        name={name}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={Boolean(fieldError(name))}
        className="pp-field"
        {...props}
      />
      {fieldError(name) && <span className="mt-1 block text-xs text-red-700">{fieldError(name)}</span>}
    </label>
  );

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6">
      <fieldset disabled={pending} className="space-y-5 disabled:opacity-70">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Try an example</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <Button
              key={example.label}
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() =>
                setValues((v) => ({
                  ...v,
                  clientName: example.clientName,
                  budget: example.budget,
                  brief: example.brief,
                }))
              }
            >
              {example.label}
            </Button>
          ))}
        </div>
      </div>

      <label className="block text-sm font-medium text-ink">
        Client brief
        <textarea
          name="brief"
          rows={6}
          value={values.brief}
          onChange={set("brief")}
          aria-invalid={Boolean(fieldError("brief"))}
          placeholder="What does the client want built, and what matters most to them?"
          className="pp-field"
        />
        {fieldError("brief") && (
          <span className="mt-1 block text-xs text-red-700">{fieldError("brief")}</span>
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("clientName", "Client name", { autoComplete: "organization" })}
        {field("clientEmail", "Client email (receives PayPal invoices)", { type: "email" })}
        {field("budget", "Budget (USD)", { type: "number", min: 100, step: 50, inputMode: "decimal" })}
        {field("startDate", "Start date", { type: "date" })}
        <label className="block text-sm font-medium text-ink">
          Payment terms
          <select
            name="paymentTermsDays"
            value={values.paymentTermsDays}
            onChange={set("paymentTermsDays")}
            className="pp-field"
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Each phase waits for the previous milestone&apos;s payment.
          </span>
        </label>
      </div>
      {field("name", "Project name (optional — AI suggests one)")}
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending}>
          {pending ? "Architect is planning…" : "Draft the plan with AI"}
        </Button>
        {pending && (
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-xs text-ink-muted">
              {STAGES[pending ? stage : 0]} Usually 10–40 seconds.
            </p>
            <div className="pp-progress mt-2" aria-hidden="true">
              <span />
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
