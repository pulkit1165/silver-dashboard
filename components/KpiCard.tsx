import type { Kpi } from "@/lib/types";
import { formatKpi, percent } from "@/lib/format";

export default function KpiCard({ kpi }: { kpi: Kpi }) {
  const hasDelta = kpi.delta !== undefined;
  const up = (kpi.delta ?? 0) >= 0;
  const negative = kpi.value < 0;
  return (
    <div className={`kpi ${negative ? "alert" : ""}`}>
      <div className="lab">{kpi.label}</div>
      <div className="num" style={negative ? { color: "var(--danger)" } : undefined}>
        {formatKpi(kpi.value, kpi.unit)}
      </div>
      <div className="sub flex items-center gap-2">
        {hasDelta && (
          <span
            className="tag"
            style={{
              background: up ? "var(--accent-2-bg)" : "var(--danger-bg)",
              color: up ? "var(--accent-2)" : "var(--danger)",
            }}
          >
            {up ? "▲" : "▼"} {percent(Math.abs(kpi.delta!))}
          </span>
        )}
        {kpi.hint && <span className="text-[var(--muted)]">{kpi.hint}</span>}
      </div>
    </div>
  );
}
