/** PaidPath mark: a timeline path whose last milestone is paid (check). */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0b1f3a" />
      <path d="M7 21h6l4-8h3" fill="none" stroke="#7cc4f8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="21" r="2.2" fill="#7cc4f8" />
      <circle cx="23.5" cy="13" r="5" fill="#22c55e" />
      <path d="M21.4 13.1l1.5 1.5 2.8-3" fill="none" stroke="#0b1f3a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <LogoMark />
      PaidPath
    </span>
  );
}
