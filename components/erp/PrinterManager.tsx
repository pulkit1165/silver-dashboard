"use client";

import { useEffect, useState } from "react";

type Size = { id: string; label: string };
type Printer = { id: string; pc: string; name: string; online: boolean; lastSeen: string; code: string; labelSize: string; locked: boolean };
type Edit = { code: string; labelSize: string; locked: boolean; busy: boolean; msg: string | null };

export default function PrinterManager({ editable }: { editable: boolean }) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/erp/print/printers");
      const d = await r.json();
      if (d.ok) {
        setPrinters(d.printers);
        setSizes(d.sizes);
        setEdits(Object.fromEntries((d.printers as Printer[]).map((p) => [p.id, { code: p.code, labelSize: p.labelSize, locked: p.locked, busy: false, msg: null }])));
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function upd(id: string, patch: Partial<Edit>) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  }
  async function save(p: Printer) {
    const e = edits[p.id];
    if (e.locked && !e.labelSize) { upd(p.id, { msg: "Pick a size before locking." }); return; }
    upd(p.id, { busy: true, msg: null });
    try {
      const r = await fetch("/api/erp/print/printers", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.id, code: e.code, label_size: e.labelSize, locked: e.locked }),
      });
      const d = await r.json();
      upd(p.id, { busy: false, msg: d.ok ? "Saved ✓" : (d.error || "Failed") });
      if (d.ok) setTimeout(() => upd(p.id, { msg: null }), 2000);
    } catch { upd(p.id, { busy: false, msg: "Network error" }); }
  }

  const sel = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

  if (loading) return <div className="panel p-6 text-center text-sm text-[var(--muted)]">Loading printers…</div>;
  if (printers.length === 0) return (
    <div className="panel p-6 text-center text-sm text-[var(--muted)]">
      No printers connected yet. Start the print agent on a PC — it registers its printers here automatically, then you can name them and lock a size.
    </div>
  );

  return (
    <section className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="rtable">
          <thead>
            <tr>
              <th></th><th>PC · printer</th><th>Code (rename)</th><th>Label size</th><th>Locked</th><th></th>
            </tr>
          </thead>
          <tbody>
            {printers.map((p) => {
              const e = edits[p.id];
              if (!e) return null;
              return (
                <tr key={p.id}>
                  <td><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.online ? "#10b981" : "#d4d4d8" }} title={p.online ? "online" : "offline"} /></td>
                  <td>
                    <div className="font-mono text-xs font-semibold">{p.name}</div>
                    <div className="text-[10px] text-[var(--muted)]">{p.pc}</div>
                  </td>
                  <td>
                    <input value={e.code} onChange={(ev) => upd(p.id, { code: ev.target.value })} disabled={!editable}
                      placeholder="e.g. PR-1" className={`${sel} w-32`} />
                  </td>
                  <td>
                    <select value={e.labelSize} onChange={(ev) => upd(p.id, { labelSize: ev.target.value })} disabled={!editable} className={`${sel} min-w-[12rem]`}>
                      <option value="">— not set —</option>
                      {sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
                      <input type="checkbox" checked={e.locked} onChange={(ev) => upd(p.id, { locked: ev.target.checked })} disabled={!editable} />
                      {e.locked ? <span className="text-[var(--accent-strong)]">🔒 Locked</span> : <span className="text-[var(--muted)]">unlocked</span>}
                    </label>
                  </td>
                  <td className="text-right">
                    {editable && (
                      <span className="inline-flex items-center gap-2">
                        {e.msg && <span className={`text-xs font-bold ${e.msg.includes("✓") ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{e.msg}</span>}
                        <button onClick={() => save(p)} disabled={e.busy}
                          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                          {e.busy ? "…" : "Save"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        <b>Code</b> renames the printer for everyone. <b>Label size</b> is the stock it's loaded with. <b>Locked</b> means only that size may be sent to this printer — the label screen auto-picks its size and blocks a mismatched print.
      </p>
    </section>
  );
}
