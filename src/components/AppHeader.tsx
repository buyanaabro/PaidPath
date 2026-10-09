import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/Logo";

export default function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-200 bg-white px-6 py-2.5">
      <div className="flex items-center gap-6">
        <Link href="/" aria-label="PaidPath home" className="text-sm">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm text-neutral-600">
          <Link href="/projects" className="hover:text-neutral-900">
            Projects
          </Link>
          <Link href="/projects/new" className="hover:text-neutral-900">
            New project
          </Link>
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {children}
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">PayPal sandbox</span>
      </div>
    </header>
  );
}
