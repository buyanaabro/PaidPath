import Link from "next/link";
import type { ReactNode } from "react";

export default function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/projects" className="text-sm font-semibold tracking-tight">
          PaidPath
        </Link>
        <nav className="text-sm text-neutral-600">
          <Link href="/projects" className="hover:text-neutral-900">
            Projects
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {children}
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
          PayPal sandbox
        </span>
      </div>
    </header>
  );
}
