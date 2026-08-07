"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Printer = { id: string; pc: string; name: string; online: boolean; lastSeen: string };
type Counts = Record<string, number>;
type Token = { id: number; token: string; label: string; active: boolean; created_by: string | null; created_at: string; last_used_at: string | null; last_used_pc: string | null };

function ago(ts: string | null): string {
  if (!ts) return "never";
  const d = new Date(ts).getTime(); if (!d) return "";
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function PrintBridge({ isAdmin }: { isAdmin: boolean }) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [tokens, setTokens] = useState<Token[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/erp/print/queue", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setPrinters(d.printers || []); setCounts(d.counts || {}); }
    } catch { /* ignore */ }
    if (isAdmin) {
      try { const t = await fetch("/api/erp/print/tokens", { cache: "no-store" }); const td = await t.json(); if (td.ok) setTokens(td.tokens || []); } catch { /* ignore */ }
    }
  }, [isAdmin]);

  useEffect(() => {
    let stop = false;
    const tick = async () => { if (!document.hidden) await load(); if (!stop) timer.current = setTimeout(tick, 5000); };
    tick();
    const onVis = () => { if (!document.hidden) { if (timer.current) clearTimeout(timer.current); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  async function copy(t: string) { try { await navigator.clipboard.writeText(t); setCopied(t); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ } }
  async function genToken() {
    setBusy(true);
    try { await fetch("/api/erp/print/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: newLabel || "Print agent" }) }); setNewLabel(""); await load(); }
    finally { setBusy(false); }
  }
  async function toggle(id: number, active: boolean) { await fetch("/api/erp/print/tokens", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, active }) }); load(); }
  async function del(id: number) { if (!confirm("Delete this token? Any PC using it stops printing.")) return; await fetch("/api/erp/print/tokens", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); load(); }

  return (
    <div className="flex flex-col gap-6">
      {/* connected devices */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-[var(--muted)]">Connected devices</h2>
          <span className="text-xs text-[var(--muted-2)]">Queued {counts.queued ?? 0} · Printing {counts.printing ?? 0} · Done {counts.done ?? 0} · Failed {counts.failed ?? 0}</span>
        </div>
        {printers.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No PC connected yet. Download the installer below, run it on a shop PC, and it appears here within ~30 seconds.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {printers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                <span className={`h-3 w-3 shrink-0 rounded-full ${p.online ? "animate-pulse bg-[var(--accent-2)]" : "bg-[var(--danger)]"}`} />
                <div className="min-w-0">
                  <div className="truncate font-bold">{p.pc}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{p.name}</div>
                </div>
                <span className={`ml-auto whitespace-nowrap text-xs font-bold ${p.online ? "text-[var(--accent-2)]" : "text-[var(--muted-2)]"}`}>{p.online ? "online" : `seen ${ago(p.lastSeen)}`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* installer */}
      <section className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-bg)] p-4">
        <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide text-[var(--accent-strong)]">Install on a shop PC</h2>
        <ol className="mb-3 ml-4 list-decimal text-sm text-[var(--fg)]">
          <li>Download the installer and send it to the PC.</li>
          <li>Unzip it and double-click <b>Install - Silver Print Agent.bat</b>.</li>
          <li>Paste a <b>token</b> (make one below) when asked. Done — it runs forever and auto-starts on every boot.</li>
        </ol>
        <a href="/agent/SilverPrintAgent-Setup.zip" download className="inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)]">⬇ Download installer (.zip)</a>
      </section>

      {/* tokens */}
      {isAdmin ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-[var(--muted)]">Install tokens</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Name it (e.g. Packing PC 1)…"
              className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <button onClick={genToken} disabled={busy} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">+ Generate token</button>
          </div>
          {tokens.length === 0 ? <p className="text-sm text-[var(--muted)]">No tokens yet — generate one and paste it into the installer on a PC.</p> : (
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-2)] text-left text-xs uppercase text-[var(--muted)]"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Token</th><th className="px-3 py-2">Last used</th><th className="px-3 py-2"></th></tr></thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} className={`border-t border-[var(--border)] ${!t.active ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-semibold">{t.label}{!t.active && <span className="ml-1 text-xs text-[var(--danger)]">(revoked)</span>}</td>
                      <td className="px-3 py-2"><button onClick={() => copy(t.token)} title="Click to copy" className="rounded bg-[var(--surface-2)] px-2 py-1 font-mono text-xs hover:bg-[var(--accent-bg)]">{copied === t.token ? "copied ✓" : t.token.slice(0, 14) + "…"}</button></td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)]">{ago(t.last_used_at)}{t.last_used_pc ? ` · ${t.last_used_pc}` : ""}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => toggle(t.id, !t.active)} className="mr-2 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-bold hover:bg-[var(--surface-2)]">{t.active ? "Revoke" : "Re-enable"}</button>
                        <button onClick={() => del(t.id)} className="rounded-lg border border-[var(--danger)] px-2.5 py-1 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger-bg)]">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-[var(--muted-2)]">Give one token to the shop to paste into the installer. Revoke it here to instantly cut off a PC. Click a token to copy it.</p>
        </section>
      ) : (
        <p className="text-sm text-[var(--muted)]">Token management is admin-only. Ask an admin for an install token.</p>
      )}
    </div>
  );
}
