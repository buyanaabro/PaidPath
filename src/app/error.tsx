"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Wordmark } from "@/components/brand/Logo";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f5f1] px-6 text-center text-[#0b1f3a]">
      <Wordmark className="text-lg" />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-[#3f4b5c]">
        PaidPath couldn&apos;t load this page. Your plan and invoices are saved — try again, or go back to your projects.
      </p>
      <div className="mt-6 flex gap-3 text-sm font-semibold">
        <button type="button" onClick={() => retry()} className="rounded-lg bg-[#0b1f3a] px-4 py-2 text-white hover:bg-[#13305a]">
          Try again
        </button>
        <Link href="/projects" className="rounded-lg border border-[#0b1f3a]/20 bg-white px-4 py-2 hover:border-[#0b1f3a]/40">
          Your projects
        </Link>
      </div>
    </main>
  );
}
