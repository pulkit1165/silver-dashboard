"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Job = { id: number; printer_id: string; name: string; pc: string; status: string; error: string | null; created_at: string; done_at: string | null; created_by: string | null };
type Printer = { id: string; pc: string; name: string; online: boolean; lastSeen: string };
type Counts = Record<string, number>;

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-[var(--surface-2)] text-[var(--muted)]" },
  printing: { label: "Printing…", cls: "bg-[var(--accent-bg)] text-[var(--accent-strong)]" },
  done: { label: "Done", cls: "bg-[var(--accent-2-bg)] text-[var(--accent-2)]" },
  failed: { label: "Failed", cls: "bg-[var(--danger-bg)] text-[var(--danger)]" },
};

function ago(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts).getTime(); if (!d) return "";
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export default function PrintQueue({ canRetry }: { canRetry: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [counts, setCounts] = useState<Counts>({ queued: 0, printing: 0, done: 0, failed: 0 });
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/erp/print/queue", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setJobs(d.jobs || []); setPrinters(d.printers || []); setCounts(d.counts || {}); }
    } catch { /* ignore */ }
    finally { setLoaded(true); }
  }, []);

  // poll while the tab is visible; pause when hidden (keeps cost down)
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!stop) timer.current = setTimeout(tick, 4000);
    };
    tick();
    const onVis = () => { if (!document.hidden) { if (timer.current) clearTimeout(timer.current); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  async function retry(id: number) {
    await fetch("/api/erp/print/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* agents / printers */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-xs font-bold uppercase text-[var(--muted)]">Print agents</div>
        {printers.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{loaded ? "No agent online yet. Install & run the agent on a shop PC (Direct bridge)." : "Loading…"}</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {printers.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${p.online ? "animate-pulse bg-[var(--accent-2)]" : "bg-[var(--danger)]"}`} />
                {p.pc} · {p.name}
                <span className={p.online ? "text-[var(--accent-2)]" : "text-[var(--muted-2)]"}>{p.online ? "online" : `last seen ${ago(p.lastSeen)}`}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["queued", "printing", "done", "failed"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <div className={`text-2xl font-extrabold tabular-nums ${k === "failed" && counts[k] ? "text-[var(--danger)]" : k === "done" ? "text-[var(--accent-2)]" : ""}`}>{counts[k] ?? 0}</div>
            <div className="text-xs font-bold uppercase text-[var(--muted)]">{STATUS[k].label}</div>
          </div>
        ))}
      </div>

      {/* recent jobs */}
      <section className="overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-left text-xs uppercase text-[var(--muted)]">
            <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Printer</th><th className="px-3 py-2">Label</th><th className="px-3 py-2">By</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const st = STATUS[j.status] ?? { label: j.status, cls: "bg-[var(--surface-2)]" };
              return (
                <tr key={j.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">{j.id}</td>
                  <td className="px-3 py-2">{j.name}<span className="block text-[10px] text-[var(--muted-2)]">{j.pc}</span></td>
                  <td className="px-3 py-2 font-mono text-xs">{(j.name && j.printer_id) ? j.printer_id.split("::")[1] ?? "" : ""}<span className="block truncate text-[var(--muted)]">{j.error ? <span className="text-[var(--danger)]">{j.error}</span> : ""}</span></td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{j.created_by || "—"}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{ago(j.created_at)}</td>
                  <td className="px-3 py-2"><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span></td>
                  <td className="px-3 py-2">{canRetry && (j.status === "failed" || j.status === "printing") && <button onClick={() => retry(j.id)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-bold hover:bg-[var(--surface-2)]">Retry</button>}</td>
                </tr>
              );
            })}
            {jobs.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--muted)]">{loaded ? "No print jobs yet." : "Loading…"}</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="text-[11px] text-[var(--muted-2)]">Auto-refreshes every few seconds while this tab is open. Only bridge (Direct) jobs appear here — PrintNode jobs are managed on printnode.com.</p>
    </div>
  );
}
