import { connection } from "next/server";
import AppHeader from "@/components/AppHeader";
import NewProjectForm from "./NewProjectForm";

export const metadata = { title: "New project — PaidPath" };

function nextMonday(from = new Date()) {
  const date = new Date(from);
  date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

export default async function NewProjectPage() {
  await connection();
  return (
    <div className="min-h-screen bg-paper text-ink">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl text-title">New project</h1>
        <p className="mb-8 text-sm text-ink-muted">
          Describe the work. The AI architect drafts phases, tasks and billable milestones that add
          up to your budget — you review it on the timeline before anything is invoiced.
        </p>
        <NewProjectForm
          defaults={{
            clientEmail: process.env.PAYPAL_SANDBOX_BUYER_EMAIL ?? "",
            startDate: nextMonday(),
          }}
        />
      </main>
    </div>
  );
}
