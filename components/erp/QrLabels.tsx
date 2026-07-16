"use client";

import { useEffect, useMemo, useState } from "react";

type Item = { id: number; sku_code: string; name: string; category: string; qty: number; status: string; token: string };

export default function QrLabels({ items }: { items: Item[] }) {
  const [svgs, setSvgs] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set(items.map((i) => i.id)));
  const [thermal, setThermal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/erp/qr/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skuIds: items.map((i) => i.id) }),
      });
      const d = await r.json();
      const map: Record<number, string> = {};
      for (const l of d.labels ?? []) map[l.skuId] = l.svg;
      setSvgs(map);
      setLoading(false);
    })();
  }, [items]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  return (
    <div className="flex flex-col gap-4">
      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <button onClick={() => setSelected(new Set(items.map((i) => i.id)))} className={btn}>Select all</button>
        <button onClick={() => setSelected(new Set())} className={btn}>Clear</button>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={thermal} onChange={(e) => setThermal(e.target.checked)} />
          Thermal (50mm)
        </label>
        <span className="text-sm text-[var(--muted)]">{chosen.length} selected</span>
        <button
          onClick={() => window.print()}
          disabled={loading || chosen.length === 0}
          className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          🖨 Print {chosen.length} label{chosen.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* selection list */}
      <div className="no-print grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((i) => (
          <label key={i.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs ${
            selected.has(i.id) ? "border-[var(--accent)] bg-[var(--accent-bg)]" : "border-[var(--border)]"
          }`}>
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <div className="min-w-0">
              <div className="truncate font-bold">{i.sku_code}</div>
              <div className="truncate text-[var(--muted)]">{i.name}</div>
            </div>
          </label>
        ))}
      </div>

      {/* printable sheet */}
      <div className="print-area">
        <div className={`grid gap-3 ${thermal ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
          {loading && <p className="text-sm text-[var(--muted)]">Generating QR codes…</p>}
          {!loading && chosen.map((i) => (
            <div key={i.id} className={`qr-label ${thermal ? "thermal" : ""}`}>
              <div dangerouslySetInnerHTML={{ __html: svgs[i.id] ?? "" }} />
              <div className="min-w-0 text-[11px] leading-tight">
                <div className="font-extrabold">Silver Industries</div>
                <div className="font-mono font-bold">{i.sku_code}</div>
                <div className="truncate">{i.name}</div>
                <div className="text-[10px] opacity-70">{i.category}</div>
                <div className="mt-1 font-mono text-[9px] opacity-60">{i.token}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const btn =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-2)]";
