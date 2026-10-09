import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f5f1] px-6 text-center text-[#0b1f3a]">
      <Wordmark className="text-lg" />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">This page or link isn&apos;t available</h1>
      <p className="mt-2 max-w-md text-sm text-[#3f4b5c]">
        If someone shared a project link with you, it may have been replaced — ask your project team for the new one. Demo
        projects expire after 24 hours.
      </p>
      <div className="mt-6 flex gap-3 text-sm font-semibold">
        <Link href="/" className="rounded-lg bg-[#0b1f3a] px-4 py-2 text-white hover:bg-[#13305a]">
          Go to PaidPath
        </Link>
        <Link href="/projects" className="rounded-lg border border-[#0b1f3a]/20 bg-white px-4 py-2 hover:border-[#0b1f3a]/40">
          Your projects
        </Link>
      </div>
    </main>
  );
}
