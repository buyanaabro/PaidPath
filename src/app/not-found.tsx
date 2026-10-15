import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center text-ink">
      <Wordmark className="text-lg" />
      <h1 className="mt-8 text-2xl text-title">This page or link isn&apos;t available</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        If someone shared a project link with you, it may have been replaced — ask your project team for the new one. Demo
        projects expire after 24 hours.
      </p>
      <div className="mt-6 flex gap-3 text-sm font-semibold">
        <Link href="/" className={buttonClass()}>
          Go to PaidPath
        </Link>
        <Link href="/projects" className={buttonClass({ variant: "secondary" })}>
          Your projects
        </Link>
      </div>
    </main>
  );
}
