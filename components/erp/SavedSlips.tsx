"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtDate } from "@/lib/erp/packing-slip-format";
import type { PackingSlipListRow } from "@/lib/erp/packing-slips";

type StatusFilter = "all" | "complete" | "draft";

// The date a slip is filed under: its own "Packing Slip Date" if set, else the day it was saved.
const effDate = (s: PackingSlipListRow) => (s.slip_date || s.updated_at || "").slice(0, 10);

export default function SavedSlips({ initial }: { initial: PackingSlipListRow[] }) {
  const [slips, setSlips] = useState<PackingSlipListRow[]>(initial);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Live: any slip saved on any device shows up here within a few seconds.
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/erp/packing-slips", { cache: "no-store" });
        const d = await r.json();
        if (Array.isArray(d.slips)) setSlips(d.slips);
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return slips.filter((s) => {
      if (status === "complete" && !s.is_complete) return false;
      if (status === "draft" && s.is_complete) return false;
      if (needle) {
        const hay = `${s.party ?? ""} ${s.slip_no} ${s.so_no ?? ""} ${s.updated_by ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      const d = effDate(s);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [slips, q, from, to, status]);

  const completeCount = slips.filter((s) => s.is_complete).length;
  const reset = () => { setQ(""); setFrom(""); setTo(""); setStatus("all"); };

  return (
    <>
      {/* filter bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Search customer / slip no.</span>
          <input
            className="ctl !w-64"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. SAMY AUTO PARTS or PS26/0001"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">From date</span>
          <input type="date" className="ctl !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">To date</span>
          <input type="date" className="ctl !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-2)]">Status</span>
          <select className="ctl !w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="complete">Completed only</option>
            <option value="draft">Drafts only</option>
          </select>
        </label>
        {(q || from || to || status !== "all") && (
          <button onClick={reset} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-bold hover:bg-[var(--surface-2)]">Clear</button>
        )}
        <span className="ml-auto text-xs font-semibold text-[var(--muted)]">
          Showing {filtered.length} of {slips.length} · {completeCount} completed
        </span>
      </div>

      {/* list */}
      <section className="panel">
        <div className="overflow-x-auto">
          <table className="rtable">
            <thead>
              <tr>
                <th>Slip No.</th>
                <th>Customer / Party</th>
                <th>Slip Date</th>
                <th>Sales Order</th>
                <th className="text-right">Boxes</th>
                <th>Status</th>
                <th>Saved by</th>
                <th>Saved at</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="!py-8 text-center text-[var(--muted)]">
                  {slips.length === 0 ? "No saved packing slips yet." : "No slips match these filters."}
                </td></tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs font-bold">{s.slip_no}</td>
                  <td className="font-semibold">{s.party || <span className="text-[var(--muted)]">—</span>}</td>
                  <td className="whitespace-nowrap">{s.slip_date ? fmtDate(s.slip_date) : "—"}</td>
                  <td className="font-mono text-xs">{s.so_no || "—"}</td>
                  <td className="text-right tabular-nums">{s.box_count || "—"}</td>
                  <td>
                    {s.is_complete
                      ? <span className="tag g">Completed</span>
                      : <span className="tag n">Draft</span>}
                  </td>
                  <td className="text-xs">{s.updated_by || "—"}</td>
                  <td className="whitespace-nowrap text-xs text-[var(--muted)]">{s.updated_at}</td>
                  <td className="text-right">
                    <Link
                      href={`/erp/packing-slip?open=${s.id}`}
                      className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-bold hover:bg-[var(--accent-bg)] hover:text-[var(--accent-strong)]"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
