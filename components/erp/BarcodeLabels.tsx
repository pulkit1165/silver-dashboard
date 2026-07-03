"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Item = { id: number; sku_code: string; name: string; category: string; masterQty: number; singleQty: number; barcodeCode: string };
type Label = {
  skuId: number; sku_code: string; name: string; unit: string;
  price: number; masterQty: number; singleQty: number; rack: string; lot: string; pkd: string;
  qrTokenSingle: string; qrTokenMaster: string; qrSvgSingle: string; qrSvgMaster: string;
};
type LabelType = "single" | "master";

// Master is only a meaningfully distinct option when it's a larger pack than
// the single/inner unit — many items have master_qty == single_qty (no real
// second tier), in which case Single already covers it.
const hasMaster = (masterQty: number, singleQty: number) => masterQty > (singleQty || 1);

// Physical die-cut sizes for the thermal roll (width × height in mm). The chosen
// size drives the print @page size so ONE label lands on ONE die-cut and sizes
// the on-screen preview 1:1. Small item rolls vs the wide 4" master roll.
type LabelSize = { id: string; label: string; w: number; h: number };
const LABEL_SIZES: LabelSize[] = [
  { id: "single-65x35", label: "Small · 65 × 35 mm (wide)", w: 65, h: 35 },
  { id: "single-50x25", label: "Small · 50 × 25 mm", w: 50, h: 25 },
  { id: "single-40x30", label: "Small · 40 × 30 mm", w: 40, h: 30 },
  { id: "single-35x65", label: "Small · 35 × 65 mm (tall)", w: 35, h: 65 },
  { id: "master-100x75", label: "Master · 100 × 75 mm (4×3\")", w: 100, h: 75 },
  { id: "master-100x50", label: "Master · 100 × 50 mm (4×2\")", w: 100, h: 50 },
  { id: "master-100x150", label: "Master · 100 × 150 mm (4×6\")", w: 100, h: 150 },
  { id: "custom", label: "Custom…", w: 0, h: 0 },
];

export default function BarcodeLabels({ items }: { items: Item[] }) {
  const [labels, setLabels] = useState<Record<number, Label>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [type, setType] = useState<Record<number, LabelType>>({});
  const [copies, setCopies] = useState(1);
  const [mode, setMode] = useState<"sheet" | "roll">("roll");
  const [sizeId, setSizeId] = useState("single-65x35");
  const [customW, setCustomW] = useState(65);
  const [customH, setCustomH] = useState(35);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const roll = mode === "roll";
  const dims = useMemo(() => {
    if (sizeId === "custom") return { w: Math.max(10, customW || 10), h: Math.max(10, customH || 10) };
    return LABEL_SIZES.find((s) => s.id === sizeId) ?? { w: 65, h: 35 };
  }, [sizeId, customW, customH]);

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
    const t = (type[i.id] === "master" && hasMaster(l.masterQty, l.singleQty) ? "master" : "single") as LabelType;
    const qrToken = t === "master" ? l.qrTokenMaster : l.qrTokenSingle;
    const qrSvg = t === "master" ? l.qrSvgMaster : l.qrSvgSingle;
    return Array.from({ length: Math.max(1, copies) }, (_, n) => ({ ...l, type: t, qrToken, qrSvg, key: `${i.id}-${t}-${n}` }));
  });

  const labelStyle = roll ? { width: `${dims.w}mm`, height: `${dims.h}mm` } : undefined;

  const renderSheet = () => (
    <div className={roll ? "flex flex-col items-start gap-3" : "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}>
      {loading && <p className="text-sm text-[var(--muted)]">Generating QR codes…</p>}
      {!loading && printable.map((l) => (
        <div key={l.key} style={labelStyle}
          className={`barcode-label ${l.type === "master" ? "master" : ""} ${roll ? "thermal" : ""}`}>
          <div className="bl-tier">{l.type === "master" ? "MASTER PACK" : "SINGLE PACK"}</div>
          <div className="bl-qr-main">
            <div dangerouslySetInnerHTML={{ __html: l.qrSvg }} />
            <span className="bl-qr-token">{l.qrToken}</span>
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
  );

  return (
    <div className="flex flex-col gap-4">
      {/* On a roll, force the paper size to the die-cut label so ONE label lands on
          ONE die-cut. Injected here so it overrides the global @page. */}
      {roll && (
        <style dangerouslySetInnerHTML={{ __html: `@media print { @page { size: ${dims.w}mm ${dims.h}mm; margin: 0; } }` }} />
      )}

      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <button onClick={() => setSelected(new Set(items.map((i) => i.id)))} className={btn}>Select all</button>
        <button onClick={() => setSelected(new Set())} className={btn}>Clear</button>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
          <button onClick={() => setMode("roll")} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${roll ? "bg-[var(--accent)] text-white" : ""}`}>Thermal roll</button>
          <button onClick={() => setMode("sheet")} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${!roll ? "bg-[var(--accent)] text-white" : ""}`}>A4 sheet</button>
        </div>

        {roll && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            Label size
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        {roll && sizeId === "custom" && (
          <span className="flex items-center gap-1 text-sm font-semibold">
            <input type="number" min={10} value={customW} onChange={(e) => setCustomW(Number(e.target.value) || 0)}
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
            ×
            <input type="number" min={10} value={customH} onChange={(e) => setCustomH(Number(e.target.value) || 0)}
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
            mm
          </span>
        )}

        <label className="flex items-center gap-2 text-sm font-semibold">
          Copies
          <input type="number" min={1} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
        </label>
        <span className="text-sm text-[var(--muted)]">{chosen.length} selected</span>
        <button
          onClick={() => {
            const skuCodes = [...new Set(printable.map((l) => l.sku_code))];
            fetch("/api/erp/labels/log-print", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ skuCodes, labelCount: printable.length }),
            }).catch(() => {});
            window.print();
          }}
          disabled={loading || printable.length === 0}
          className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          🖨 Print {printable.length} label{printable.length === 1 ? "" : "s"}
        </button>
      </div>
      {roll && (
        <p className="no-print -mt-2 text-xs text-[var(--muted)]">
          One label per die-cut (<b>{dims.w} × {dims.h} mm</b>). Load the matching roll, then in the print dialog
          set paper size to <b>{dims.w} × {dims.h} mm</b>, Margins <b>None</b>, Scale <b>100% / Actual size</b>.
          Print the small size on the item roll, the Master 4″ size on the wide roll.
        </p>
      )}

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

      {/* On-screen preview (inline). In print this is hidden — the body-level
          portal below is what actually prints. */}
      <div className={`print-area ${roll ? "roll" : ""}`}>{renderSheet()}</div>

      {/* Print target lifted to <body> so the app chrome (sidebar/header) can't
          push labels down or add blank pages between die-cuts. */}
      {mounted && createPortal(
        <div className={`labels-print-portal print-area ${roll ? "roll" : ""}`}>{renderSheet()}</div>,
        document.body,
      )}
    </div>
  );
}

const btn =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-2)]";
