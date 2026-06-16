import type { DataMode } from "@/lib/types";

export default function ModeBanner({ mode, note }: { mode: DataMode; note?: string }) {
  const live = mode === "oracle";
  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
      style={{
        borderColor: live ? "var(--accent-2)" : "#f0c98a",
        background: live ? "var(--accent-2-bg)" : "var(--warning-bg)",
      }}
    >
      <span
        className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: live ? "var(--accent-2)" : "var(--warning)" }}
      />
      <div>
        <span className="font-bold" style={{ color: live ? "var(--accent-2)" : "var(--warning)" }}>
          {live ? "Live data — Oracle SILVER_2026" : "Sample data"}
        </span>
        {note && <span className="text-[var(--muted)]"> · {note}</span>}
      </div>
    </div>
  );
}
