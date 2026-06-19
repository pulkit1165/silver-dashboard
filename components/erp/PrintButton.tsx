"use client";
export default function PrintButton({ label = "🖨 Print label" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]"
    >
      {label}
    </button>
  );
}
