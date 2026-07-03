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

// The four physical label stocks Silver uses (width × height in mm). Any SKU can
// print on any size. The chosen size drives the print @page size so ONE label
// lands on ONE die-cut and sizes the on-screen preview 1:1.
type LabelSize = { id: string; label: string; w: number; h: number };
const LABEL_SIZES: LabelSize[] = [
  { id: "big-95x70", label: "Big green · 95 × 70 mm", w: 95, h: 70 },
  { id: "red-85x55", label: "Red · 85 × 55 mm", w: 85, h: 55 },
  { id: "med-70x40", label: "Medium green · 70 × 40 mm", w: 70, h: 40 },
  { id: "small-50x30", label: "Small green · 50 × 30 mm", w: 50, h: 30 },
  { id: "custom", label: "Custom…", w: 0, h: 0 },
];

export default function BarcodeLabels({ items }: { items: Item[] }) {
  const [labels, setLabels] = useState<Record<number, Label>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [type, setType] = useState<Record<number, LabelType>>({});
  const [copies, setCopies] = useState(1);
  const [mode, setMode] = useState<"sheet" | "roll">("roll");
  const [sizeId, setSizeId] = useState("med-70x40");
  const [customW, setCustomW] = useState(70);
  const [customH, setCustomH] = useState(40);
  const [loading, setLoading] = useState(false);
  const [rotate, setRotate] = useState(false);
  // Silver's labels already have the company address (and colour) printed on
  // them, so by default we print ONLY the black content into the blank area.
  const [preprinted, setPreprinted] = useState(true);
  // Where in the blank area our content sits: green labels have the address at
  // the bottom (content = top); the red label has its banner at the top (content = bottom).
  const [contentPos, setContentPos] = useState<"top" | "bottom">("top");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const roll = mode === "roll";
  const dims = useMemo(() => {
    if (sizeId === "custom") return { w: Math.max(10, customW || 10), h: Math.max(10, customH || 10) };
    return LABEL_SIZES.find((s) => s.id === sizeId) ?? { w: 70, h: 40 };
  }, [sizeId, customW, customH]);
  // The printed page matches the die-cut. If the roll feeds the label the other
  // way, "Rotate 90°" swaps the page and spins the label so it still reads right.
  const pageW = rotate ? dims.h : dims.w;
  const pageH = rotate ? dims.w : dims.h;

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

  // Exact-size PDF (one label per page, page = the die-cut). Printing this at
  // "Actual size" is far more reliable than the browser's HTML print.
  async function downloadPdf() {
    if (printable.length === 0) return;
    const payload = {
      labels: printable.map((l) => ({
        qrToken: l.qrToken, name: l.name, type: l.type,
        masterQty: l.masterQty, singleQty: l.singleQty, unit: l.unit, price: l.price,
        lot: l.lot, rack: l.rack, pkd: l.pkd,
      })),
      w: dims.w, h: dims.h, preprinted, contentPos,
    };
    const r = await fetch("/api/erp/labels/pdf", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `labels-${dims.w}x${dims.h}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const renderSheet = () => (
    <div className={roll ? "flex flex-col items-start gap-3" : "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}>
      {loading && <p className="text-sm text-[var(--muted)]">Generating QR codes…</p>}
      {!loading && printable.map((l) => {
        const label = (
        <div style={labelStyle}
          className={`barcode-label ${l.type === "master" ? "master" : ""} ${roll ? "thermal" : ""} ${rotate ? "rot" : ""} ${preprinted ? "preprinted" : ""} pos-${contentPos}`}>
          <div className="bl-row">
            <div className="bl-qr-main">
              <div dangerouslySetInnerHTML={{ __html: l.qrSvg }} />
              <span className="bl-qr-token">{l.qrToken}</span>
            </div>
            <div className="bl-body">
              <div className="bl-tier">{l.type === "master" ? "MASTER PACK" : "SINGLE PACK"}</div>
              <div className="bl-name">{l.name}</div>
              <div className="bl-qty">
                {l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`}
                {" · "}MRP.Rs.{l.price.toFixed(0)}/-{l.type === "master" ? " E" : ""}
              </div>
              <div className="bl-meta">
                <span>Lot: {l.lot || "—"}</span>
                <span>{l.type === "master" ? "Rack_No" : "RackNo"}: {l.rack || "—"}</span>
                <span>PKD: {l.pkd}</span>
              </div>
              {!preprinted && <div className="bl-tax">(Incl. of All Taxes)</div>}
            </div>
          </div>
          {/* Company address is skipped on pre-printed stock (it's already on the label). */}
          {!preprinted && (
            <div className="bl-footer">
              <div>SILVER IND. 50, OSWAL IND. COMPLEX</div>
              <div>G.T. ROAD, LUDHIANA-141010</div>
              <div>CUS. CARE: Mail: silverup.ldh@gmail.com PH.NO. 0161-5196409</div>
            </div>
          )}
        </div>
        );
        // In roll mode every label sits in a page-sized box (so it's exactly one
        // die-cut per page) and the label is centred + optionally rotated inside it.
        return roll ? (
          <div key={l.key} className="label-rot" style={{ width: `${pageW}mm`, height: `${pageH}mm` }}>{label}</div>
        ) : (
          <div key={l.key} className="contents">{label}</div>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* On a roll, force the paper size to the die-cut label so ONE label lands on
          ONE die-cut. Injected here so it overrides the global @page. */}
      {roll && (
        <style dangerouslySetInnerHTML={{ __html: `@media print { @page { size: ${pageW}mm ${pageH}mm; margin: 0; } }` }} />
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
        {roll && (
          <label className="flex items-center gap-2 text-sm font-semibold" title="If your printer feeds the label the other way (prints sideways), turn this on.">
            <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
            Rotate 90°
          </label>
        )}
        {roll && (
          <label className="flex items-center gap-2 text-sm font-semibold" title="Your labels already have the address & colour printed. Keep this on so we print only the QR + item details into the blank area.">
            <input type="checkbox" checked={preprinted} onChange={(e) => setPreprinted(e.target.checked)} />
            Pre-printed labels
          </label>
        )}
        {roll && preprinted && (
          <label className="flex items-center gap-2 text-sm font-semibold" title="Green labels have the address at the bottom (content → Top). The red label has its banner at the top (content → Bottom).">
            Content
            <select value={contentPos} onChange={(e) => setContentPos(e.target.value as "top" | "bottom")}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm font-semibold">
          Copies
          <input type="number" min={1} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" />
        </label>
        <span className="text-sm text-[var(--muted)]">{chosen.length} selected</span>
        {roll && (
          <button
            onClick={downloadPdf}
            disabled={loading || printable.length === 0}
            title="Download an exact-size PDF (one label per page). Print it at Actual size — far more reliable than the browser print."
            className="ml-auto rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)] disabled:opacity-50"
          >
            ⤓ PDF ({dims.w}×{dims.h})
          </button>
        )}
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
          className={`${roll ? "" : "ml-auto "}rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50`}
        >
          🖨 Print {printable.length} label{printable.length === 1 ? "" : "s"}
        </button>
      </div>
      {roll && (
        <p className="no-print -mt-2 text-xs text-[var(--muted)]">
          Set your <b>printer's label/paper size to {pageW} × {pageH} mm</b> in its driver (this is what stops the
          sideways / shrunk / 3-labels problem), then in the print dialog use that paper, <b>Margins = None</b>,
          <b> Scale = 100%</b>. Prints sideways → tick <b>Rotate 90°</b>. Content lands on the pre-printed address →
          switch <b>Content</b> to Top/Bottom.
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
