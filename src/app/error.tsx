"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Wordmark } from "@/components/brand/Logo";
import Button, { buttonClass } from "@/components/ui/Button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center text-ink">
      <Wordmark className="text-lg" />
      <h1 className="mt-8 text-2xl text-title">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        PaidPath couldn&apos;t load this page. Your plan and invoices are saved — try again, or go back to your projects.
      </p>
      <div className="mt-6 flex gap-3 text-sm font-semibold">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/projects" className={buttonClass({ variant: "secondary" })}>
          Your projects
        </Link>
      </div>
    </main>
  );
}
