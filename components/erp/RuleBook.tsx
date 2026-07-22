"use client";

import { useMemo, useState } from "react";
import type { ModuleRules, RuleStatus } from "@/lib/erp/rulebook";

const DOT: Record<RuleStatus, { cls: string; label: string }> = {
  pass: { cls: "bg-[var(--accent-2)]", label: "Working" },
  fail: { cls: "bg-[var(--danger)]", label: "Failing" },
  manual: { cls: "bg-[var(--muted-2)]", label: "Manual" },
};

function tally(mods: ModuleRules[]) {
  const t = { pass: 0, fail: 0, manual: 0, total: 0 };
  for (const m of mods) for (const r of m.rules) { t[r.status]++; t.total++; }
  return t;
}

export default function RuleBook({ initial }: { initial: ModuleRules[] }) {
  const [mods, setMods] = useState<ModuleRules[]>(initial);
  const [open, setOpen] = useState<Set<string>>(() => new Set(initial.map((m) => m.module)));
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const t = useMemo(() => tally(mods), [mods]);

  async function reverify() {
    setBusy(true);
    try {
      const r = await fetch("/api/erp/rulebook", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) { setMods(d.modules); setRanAt(new Date().toLocaleTimeString()); }
    } finally { setBusy(false); }
  }
  function toggle(m: string) { setOpen((s) => { const n = new Set(s); n.has(m) ? n.delete(m) : n.add(m); return n; }); }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <section className="panel flex flex-wrap items-center gap-4 p-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-2)]" />
          <span className="text-sm font-bold tabular-nums">{t.pass}</span>
          <span className="text-xs text-[var(--muted)]">working</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
          <span className="text-sm font-bold tabular-nums">{t.fail}</span>
          <span className="text-xs text-[var(--muted)]">failing</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted-2)]" />
          <span className="text-sm font-bold tabular-nums">{t.manual}</span>
          <span className="text-xs text-[var(--muted)]">manual</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {ranAt && <span className="text-xs text-[var(--muted)]">re-verified {ranAt}</span>}
          <button onClick={reverify} disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
            {busy ? "Verifying…" : "↻ Re-verify all"}
          </button>
        </div>
        {t.fail > 0 && (
          <div className="w-full rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-sm font-semibold text-[var(--danger)]">
            ⚠ {t.fail} rule{t.fail === 1 ? "" : "s"} failing — expand the red module{t.fail === 1 ? "" : "s"} below.
          </div>
        )}
      </section>

      {mods.map((m) => {
        const mt = m.rules.reduce((a, r) => { a[r.status]++; return a; }, { pass: 0, fail: 0, manual: 0 } as Record<RuleStatus, number>);
        const isOpen = open.has(m.module);
        const badge = mt.fail > 0 ? DOT.fail : mt.pass === m.rules.length ? DOT.pass : DOT.manual;
        return (
          <section key={m.module} className="panel overflow-hidden">
            <button onClick={() => toggle(m.module)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="text-lg" aria-hidden>{m.icon}</span>
              <span className="text-sm font-extrabold">{m.module}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${badge.cls}`} title={badge.label} />
              <span className="text-xs font-semibold text-[var(--muted)]">
                {mt.pass}/{m.rules.length} working{mt.fail ? ` · ${mt.fail} failing` : ""}{mt.manual ? ` · ${mt.manual} manual` : ""}
              </span>
              <span className="ml-auto text-[var(--muted)] transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
            </button>
            {isOpen && (
              <div className="border-t border-[var(--border)]">
                {m.rules.map((r) => {
                  const d = DOT[r.status];
                  return (
                    <div key={r.id} className="flex gap-3 border-b border-[var(--border-2)] px-4 py-3 last:border-0">
                      <span className={`mt-1.5 h-3 w-3 flex-none rounded-full ${d.cls}`} title={d.label} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-bold">{r.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            r.status === "pass" ? "bg-[var(--accent-2-bg)] text-[var(--accent-2)]"
                            : r.status === "fail" ? "bg-[var(--danger-bg)] text-[var(--danger)]"
                            : "bg-[var(--surface-2)] text-[var(--muted)]"}`}>{d.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{r.detail}</p>
                        {r.note && <p className={`mt-1 font-mono text-xs ${r.status === "fail" ? "text-[var(--danger)]" : "text-[var(--muted-2)]"}`}>› {r.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
