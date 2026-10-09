/** Creates the visitor's own demo copy (works without JavaScript). */
export default function DemoButton({ className = "", label = "Try the live demo" }: { className?: string; label?: string }) {
  return (
    <form action="/api/demo" method="post">
      <button
        type="submit"
        className={`rounded-lg bg-[#0070ba] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#005ea6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0070ba] ${className}`}
      >
        {label}
      </button>
    </form>
  );
}
