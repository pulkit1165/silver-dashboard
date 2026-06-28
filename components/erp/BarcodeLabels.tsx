"use client";

import { useEffect, useMemo, useState } from "react";

type Item = { id: number; sku_code: string; name: string; category: string; masterQty: number; singleQty: number; barcodeCode: string };
type Label = {
  skuId: number; sku_code: string; code: string; name: string; unit: string;
  price: number; masterQty: number; singleQty: number; rack: string; lot: string; pkd: string; svg: string;
};
type LabelType = "single" | "master";

// Master is only a meaningfully distinct option when it's a larger pack than
// the single/inner unit — many items have master_qty == single_qty (no real
// second tier), in which case Single already covers it.
const hasMaster = (masterQty: number, singleQty: number) => masterQty > (singleQty || 1);

export default function BarcodeLabels({ items }: { items: Item[] }) {
  const [labels, setLabels] = useState<Record<number, Label>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [type, setType] = useState<Record<number, LabelType>>({});
  const [copies, setCopies] = useState(1);
  const [thermal, setThermal] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const setLabelType = (id: number, t: LabelType) => setType((m) => ({ ...m, [id]: t }));

  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  useEffect(() => {
    const missing = chosen.map((i) => i.id).filter((id) => !labels[id]);
    if (missing.length === 0) return;
    setLoading(true);
    (async () => {
      const r = await fetch("/api/erp/labels/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skuIds: missing }),
      });
      const d = await r.json();
      setLabels((prev) => {
        const next = { ...prev };
        for (const l of d.labels ?? []) next[l.skuId] = l;
        return next;
      });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const printable = chosen.flatMap((i) => {
    const l = labels[i.id];
    if (!l) return [];
    const t = type[i.id] === "master" && hasMaster(l.masterQty, l.singleQty) ? "master" : "single";
    return Array.from({ length: Math.max(1, copies) }, (_, n) => ({ ...l, type: t as LabelType, key: `${i.id}-${t}-${n}` }));
  });

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
        <label className="flex items-center gap-2 text-sm font-semibold">
          Copies
          <input type="number" min={1} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
        </label>
        <span className="text-sm text-[var(--muted)]">{chosen.length} selected</span>
        <button
          onClick={() => window.print()}
          disabled={loading || printable.length === 0}
          className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          🖨 Print {printable.length} label{printable.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* selection list */}
      <div className="no-print flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className={`flex items-center gap-3 rounded-lg border p-2 text-xs ${
            selected.has(i.id) ? "border-[var(--accent)] bg-[var(--accent-bg)]" : "border-[var(--border)]"
          }`}>
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{i.sku_code} · {i.name}</div>
              <div className="truncate text-[var(--muted)]">{i.category}</div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setLabelType(i.id, "single")}
                className={`rounded px-2 py-1 font-semibold ${(type[i.id] ?? "single") === "single" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
              >
                Single
              </button>
              <button
                onClick={() => setLabelType(i.id, "master")}
                disabled={!hasMaster(i.masterQty, i.singleQty)}
                title={hasMaster(i.masterQty, i.singleQty) ? "" : "No distinct master carton qty set for this SKU"}
                className={`rounded px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${type[i.id] === "master" && hasMaster(i.masterQty, i.singleQty) ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
              >
                Master{hasMaster(i.masterQty, i.singleQty) ? ` (${i.masterQty})` : ""}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* printable sheet */}
      <div className="print-area">
        <div className={`grid gap-3 ${thermal ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
          {loading && <p className="text-sm text-[var(--muted)]">Generating barcodes…</p>}
          {!loading && printable.map((l) => (
            <div key={l.key} className={`barcode-label ${l.type === "master" ? "master" : ""} ${thermal ? "thermal" : ""}`}>
              <div className="bl-head">
                {l.type === "master" && <div className="bl-code">CODE: {l.code}</div>}
                <div dangerouslySetInnerHTML={{ __html: l.svg }} />
              </div>
              <div className="bl-name">{l.name}</div>
              <div className="bl-qty">
                {l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`}
                {" · "}MRP.Rs.{l.price.toFixed(0)}/-{l.type === "master" ? " E" : ""}
              </div>
              <div className="bl-tax">(Incl. of All Taxes)</div>
              <div className="bl-meta">
                <span>Lot: {l.lot || "—"}</span>
                <span>{l.type === "master" ? "Rack_No" : "RackNo"}: {l.rack || "—"}</span>
                <span>PKD: {l.pkd}</span>
              </div>
              <div className="bl-footer">
                <div>SILVER IND. 50, OSWAL IND. COMPLEX</div>
                <div>G.T. ROAD, LUDHIANA-141010</div>
                <div>CUS. CARE: Mail: silverup.ldh@gmail.com PH.NO. 0161-5196409</div>
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
