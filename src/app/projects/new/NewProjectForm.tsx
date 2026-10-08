"use client";

import { useActionState, useState } from "react";
import { createProjectFromBrief, type BriefFormState } from "../actions";

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

const inputClass =
  "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-invalid:border-red-500";

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
    brief: "",
  });
  const set = (field: keyof typeof values) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setValues((v) => ({ ...v, [field]: event.target.value }));
  const fieldError = (field: string) => state.fieldErrors?.[field];

  const field = (name: keyof typeof values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      <input
        name={name}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={Boolean(fieldError(name))}
        className={inputClass}
        {...props}
      />
      {fieldError(name) && <span className="mt-1 block text-xs text-red-700">{fieldError(name)}</span>}
    </label>
  );

  return (
    <form action={formAction} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Try an example</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              disabled={pending}
              onClick={() =>
                setValues((v) => ({
                  ...v,
                  clientName: example.clientName,
                  budget: example.budget,
                  brief: example.brief,
                }))
              }
              className="rounded-full border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-sm font-medium text-neutral-800">
        Client brief
        <textarea
          name="brief"
          rows={6}
          value={values.brief}
          onChange={set("brief")}
          aria-invalid={Boolean(fieldError("brief"))}
          placeholder="What does the client want built, and what matters most to them?"
          className={inputClass}
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
      </div>
      {field("name", "Project name (optional — AI suggests one)")}

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60"
        >
          {pending ? "Architect is planning…" : "Draft the plan with AI"}
        </button>
        {pending && (
          <p className="text-xs text-neutral-500" aria-live="polite">
            Breaking the brief into phases, sizing tasks and pricing milestones — usually 10–40
            seconds.
          </p>
        )}
      </div>
    </form>
  );
}
