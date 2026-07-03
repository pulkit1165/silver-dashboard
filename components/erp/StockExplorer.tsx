"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Movement = "fast" | "medium" | "slow" | "dead" | "none";
type Status = "out" | "low" | "reorder" | "ok";
export type StockRow = {
  id: number; sku_code: string; name: string; category: string; unit: string; price: number;
  qty: number; value: number; sold: number; last_out: string | null;
  status: Status; movement: Movement; low: boolean;
};
type Tab = "all" | "fast" | "medium" | "slow" | "dead" | "low";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const MOVE: Record<Movement, { label: string; cls: string }> = {
  fast: { label: "Fast", cls: "g" }, medium: { label: "Medium", cls: "n" },
  slow: { label: "Slow", cls: "n" }, dead: { label: "Dead", cls: "r" }, none: { label: "—", cls: "n" },
};
const STATUS: Record<Status, string> = { out: "r", low: "r", reorder: "n", ok: "g" };
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fast", label: "Fast moving" },
  { key: "medium", label: "Medium moving" },
  { key: "slow", label: "Slow moving" },
  { key: "dead", label: "Dead stock" },
  { key: "low", label: "Low inventory" },
];

export default function StockExplorer({ initial, initialWindow }: { initial: StockRow[]; initialWindow: number }) {
  const [rows, setRows] = useState<StockRow[]>(initial);
  const [win, setWin] = useState<number>(initialWindow);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  // live: re-pull as the window changes and every few seconds (scans move stock)
  useEffect(() => {
    let stop = false; let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch(`/api/erp/stock?window=${win}`, { cache: "no-store" });
        const d = await r.json();
        if (d.ok && Array.isArray(d.rows)) setRows(d.rows);
      } catch { /* ignore */ }
      if (!stop) t = setTimeout(load, 5000);
    };
    load();
    return () => { stop = true; clearTimeout(t); };
  }, [win]);

  const counts = useMemo(() => ({
    all: rows.length,
    fast: rows.filter((r) => r.movement === "fast").length,
    medium: rows.filter((r) => r.movement === "medium").length,
    slow: rows.filter((r) => r.movement === "slow").length,
    dead: rows.filter((r) => r.movement === "dead").length,
    low: rows.filter((r) => r.low).length,
  }), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "low") { if (!r.low) return false; }
      else if (tab !== "all") { if (r.movement !== tab) return false; }
      if (needle) {
        const hay = `${r.sku_code} ${r.name} ${r.category ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, tab]);

  const stockValue = useMemo(() => rows.reduce((a, r) => a + r.value, 0), [rows]);
  const deadValue = useMemo(() => rows.filter((r) => r.movement === "dead").reduce((a, r) => a + r.value, 0), [rows]);
  const units = useMemo(() => rows.reduce((a, r) => a + r.qty, 0), [rows]);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="kpi"><div className="lab">SKUs</div><div className="num">{rows.length}</div></div>
        <div className="kpi"><div className="lab">Total units</div><div className="num">{inr(units)}</div></div>
        <div className="kpi alert"><div className="lab">Low / out</div><div className="num" style={{ color: "var(--danger)" }}>{counts.low}</div></div>
        <div className="kpi"><div className="lab">Dead-stock value</div><div className="num" style={{ color: "var(--danger)" }}>{inr(deadValue)}</div></div>
        <div className="kpi"><div className="lab">Stock value</div><div className="num">{inr(stockValue)}</div></div>
      </div>

      {/* controls: SKU search + movement window */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Filter by SKU</span>
          <input className="ctl !w-72" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name or category…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Movement window</span>
          <select className="ctl !w-auto" value={win} onChange={(e) => setWin(Number(e.target.value))}>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </label>
      </div>

      {/* category tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-strong)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)] text-[var(--muted-2)]"}`}>
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable" style={{ minWidth: "820px" }}>
            <thead>
              <tr>
                <th>SKU</th><th>Category</th>
                <th className="!text-right">On hand</th>
                <th className="!text-right">Sold ({win}d)</th>
                <th>Movement</th><th>Stock status</th>
                <th className="!text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="!py-8 text-center text-[var(--muted)]">
                  {rows.length === 0 ? "No SKUs yet." : "No items match this filter."}
                </td></tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/erp/skus/${s.id}`} className="font-semibold text-[var(--accent)] hover:underline">{s.name}</Link>
                    <div className="font-mono text-xs text-[var(--muted)]">{s.sku_code}</div>
                  </td>
                  <td className="text-xs text-[var(--muted)]">{s.category || "—"}</td>
                  <td className="num-cell">{inr(s.qty)}</td>
                  <td className="num-cell">
                    {s.sold ? inr(s.sold) : <span className="text-[var(--muted-2)]">0</span>}
                    {s.movement === "dead" && <div className="text-[10px] text-[var(--muted-2)]">last out: {s.last_out ? s.last_out.slice(0, 10) : "never"}</div>}
                  </td>
                  <td><span className={`tag ${MOVE[s.movement].cls}`}>{MOVE[s.movement].label}</span></td>
                  <td><span className={`tag ${STATUS[s.status]}`}>{s.status}</span></td>
                  <td className="num-cell">{inr(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-3 text-xs text-[var(--muted)]">
        <b>Fast / Medium / Slow</b> rank SKUs by units shipped in the chosen window (relative to the rest of the catalogue).
        <b> Dead stock</b> = has units on hand but no dispatch in the window. <b>Low inventory</b> = on-hand at or below the reorder level.
      </p>
    </>
  );
}
