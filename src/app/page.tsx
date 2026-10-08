import GanttClient from "@/components/gantt/GanttClient";

export default function Home() {
  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">PaidPath</h1>
          <p className="text-xs text-neutral-500">
            The project plan that reacts to money.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
          PayPal sandbox
        </span>
      </header>
      <section className="min-h-0 flex-1">
        <GanttClient />
      </section>
    </main>
  );
}
