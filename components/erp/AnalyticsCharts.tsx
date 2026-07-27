"use client";

import { useState } from "react";

// CVD-validated categorical palette (validate_palette.js → all checks pass).
export const CAT = ["#cc1f2d", "#1d4ed8", "#0e7a43", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const SEQ = "#2563eb"; // single hue for magnitude (ranked bars, trends)

// ── formatters (Indian) ─────────────────────────────────────────────────────
export function inr(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}
export function num(v: number): string {
  return v.toLocaleString("en-IN");
}
const shortDate = (d: string) => {
  const [, m, day] = d.split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)] ?? m;
  return `${day} ${mon}`;
};

// ── Stat tile (hero number) ─────────────────────────────────────────────────
export function StatTile({ label, value, sub, accent = SEQ }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />{label}
      </div>
      <div className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs font-semibold text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

// ── Area + line trend with crosshair tooltip ────────────────────────────────
export function AreaTrend({ data, color = SEQ, valueKey, height = 240, unit = "money" }:
  { data: Array<Record<string, number | string>>; color?: string; valueKey: string; height?: number; unit?: "money" | "count" }) {
  const [hi, setHi] = useState<number | null>(null);
  if (data.length === 0) return <Empty />;
  const W = 900, H = height, padL = 8, padR = 8, padT = 16, padB = 24;
  const vals = data.map((d) => Number(d[valueKey]) || 0);
  const max = Math.max(1, ...vals);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, data.length - 1);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const pts = data.map((d, i) => `${x(i)},${y(Number(d[valueKey]) || 0)}`).join(" ");
  const area = `${padL},${H - padB} ${pts} ${x(data.length - 1)},${H - padB}`;
  const fmt = unit === "money" ? inr : num;
  const gid = `g-${valueKey}-${color.replace("#", "")}`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - padL) / (W - padL - padR)) * (data.length - 1));
          setHi(Math.max(0, Math.min(data.length - 1, i)));
        }}
        onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gid})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hi != null && (
          <>
            <line x1={x(hi)} y1={padT} x2={x(hi)} y2={H - padB} stroke={color} strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity="0.5" />
            <circle cx={x(hi)} cy={y(vals[hi])} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] font-semibold text-[var(--muted-2)]">
        <span>{shortDate(String(data[0].d))}</span>
        <span>{shortDate(String(data[data.length - 1].d))}</span>
      </div>
      {hi != null && (
        <div className="pointer-events-none absolute -top-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(x(hi) / W) * 100}%`, transform: "translateX(-50%)" }}>
          <div className="font-bold tabular-nums">{fmt(vals[hi])}</div>
          <div className="text-[10px] font-semibold text-[var(--muted)]">{shortDate(String(data[hi].d))}</div>
        </div>
      )}
    </div>
  );
}

// ── Ranked horizontal bars (magnitude) ──────────────────────────────────────
export function RankedBars({ rows, color = SEQ, unit = "count", max: rowsMax }:
  { rows: Array<{ label: string; sub?: string; value: number }>; color?: string; unit?: "money" | "count"; max?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const max = rowsMax ?? Math.max(1, ...rows.map((r) => r.value));
  const fmt = unit === "money" ? inr : num;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(120px,220px)_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5"
          onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
          style={{ background: hi === i ? "var(--surface-2)" : "transparent" }}>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold">{r.label}</div>
            {r.sub && <div className="truncate text-[10px] text-[var(--muted)]">{r.sub}</div>}
          </div>
          <div className="h-5 rounded-[4px] bg-[var(--surface-2)]">
            <div className="h-5 rounded-[4px]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color, opacity: hi == null || hi === i ? 1 : 0.55 }} />
          </div>
          <div className="w-20 text-right text-xs font-bold tabular-nums">{fmt(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Donut (categorical share) with legend + labels ──────────────────────────
export function Donut({ rows, unit = "money", size = 200 }:
  { rows: Array<{ label: string; value: number }>; unit?: "money" | "count"; size?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  if (rows.length === 0) return <Empty />;
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const top = rows.slice(0, 7);
  const rest = rows.slice(7);
  const items = rest.length ? [...top, { label: "Other", value: rest.reduce((a, r) => a + r.value, 0) }] : top;
  const fmt = unit === "money" ? inr : num;
  const r = size / 2, ir = r * 0.62, cx = r, cy = r;
  let a0 = -Math.PI / 2;
  const arcs = items.map((it, i) => {
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const d = `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, ir)} A ${ir} ${ir} 0 ${large} 0 ${p(a0, ir)} Z`;
    a0 = a1;
    return { d, color: CAT[i % CAT.length], it, frac };
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} stroke="#fff" strokeWidth="2"
            opacity={hi == null || hi === i ? 1 : 0.4} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 18, fontWeight: 800 }}>
          {hi != null ? `${Math.round(arcs[hi].frac * 100)}%` : fmt(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10, fontWeight: 700 }}>
          {hi != null ? arcs[hi].it.label.slice(0, 16) : "TOTAL"}
        </text>
      </svg>
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 rounded px-1 text-xs" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
            style={{ background: hi === i ? "var(--surface-2)" : "transparent" }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{a.it.label}</span>
            <span className="tabular-nums text-[var(--muted)]">{Math.round(a.frac * 100)}%</span>
            <span className="w-16 text-right font-bold tabular-nums">{fmt(a.it.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--border)] text-center text-sm text-[var(--muted)]">
      <span className="text-2xl opacity-40">▤</span>
      No data yet — connect the Oracle link to populate this report.
    </div>
  );
}
