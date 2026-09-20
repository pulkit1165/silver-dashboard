"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SearchSelect, { type SearchOption } from "./SearchSelect";
import { type LabelDoc, type LabelFill } from "@/lib/erp/labelDoc";
import { renderDoc, ensureFontsLoaded } from "@/lib/erp/labelRender";

export type QuickSkuData = {
  id: number; sku_code: string; name: string; header: string;
  price: number; unit: string; masterQty: number; singleQty: number;
  locations: { batch: string; rack: string; qty: number }[];
  pkd: string;
  qrTokenSingle: string; qrTokenMaster: string;
  qrSvgSingle: string; qrSvgMaster: string;
  qrMatrixSingle?: { size: number; data: number[] };
  qrMatrixMaster?: { size: number; data: number[] };
};

type Size = { id: string; label: string; w: number; h: number };
type Printer = { id: string; pc: string; name: string; online: boolean };

// Each physical stock lives on a dedicated PC/printer — this is a hardware
// fact, not a preference, so a picked SIZE should pick its printer by
// default. Matched by computer name (+ a model hint where one PC has more
// than one printer registered, e.g. both a "Plus" and a "Pro" on the same
// box) against the live bridge printer list; falls back gracefully if that
// PC isn't online. Keyed by the BASE size id (sticker-* strips its prefix
// before lookup, since the printer assignment is about the physical stock).
const AUTO_PRINTER_BY_SIZE: Record<string, { pc: string; modelHint?: string }> = {
  "small-50x30": { pc: "DESKTOP-M3P9SLE" },
  "big-95x70": { pc: "DESKTOP-U8693H8" },
  "red-85x55": { pc: "DESKTOP-U8693H8" },
  "med-70x40": { pc: "DESKTOP-CII1LAK", modelHint: "plus" },
};

// Fast, single-SKU print: pick a SKU, lot auto-suggests from live inventory
// (rack comes along with it — rack is a property of the (SKU, lot) pair, not
// a separate guess), then click the photo of the size you want to print it.
// No separate "Print" button, no bulk-select — mirrors the client's legacy
// label-printing screen. Shared by both the labels and stickers print pages;
// the two differ only in what `fetchSkuData`/`extendFill`/`onPrint` do.
export default function QuickPrintPanel({
  sizes,
  skuOptions,
  fetchSkuData,
  extendFill,
  onPrint,
}: {
  sizes: Size[];
  skuOptions: SearchOption[];
  /** `value` is whatever the caller put in skuOptions — an id or a synthetic index; caller decides what it means. */
  fetchSkuData: (value: number) => Promise<QuickSkuData | null>;
  /** Layer extra LabelFill fields on top of the shared baseline (e.g. stickers' abbr1/abbr2). */
  extendFill?: (data: QuickSkuData) => Partial<LabelFill>;
  onPrint: (data: QuickSkuData, sizeId: string, doc: LabelDoc, fill: LabelFill, copies: number, printerId: string | null) => Promise<{ ok: boolean; text: string }>;
}) {
  const [skuValue, setSkuValue] = useState<number | null>(null);
  const [data, setData] = useState<QuickSkuData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [lotIdx, setLotIdx] = useState(0);
  const [lot, setLot] = useState("");
  const [rack, setRack] = useState("");
  const [tier, setTier] = useState<"single" | "master">("single");
  const [copies, setCopies] = useState(1);
  const [docsBySize, setDocsBySize] = useState<Record<string, LabelDoc | null>>({});
  const [printingSizeId, setPrintingSizeId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerOverride, setPrinterOverride] = useState<string>(""); // "" = Auto

  useEffect(() => {
    fetch("/api/erp/print/printers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPrinters(d.printers || d || []))
      .catch(() => {});
  }, []);

  // The dedicated printer for a size's physical stock, falling back to the
  // first online printer if that PC isn't reachable, else null.
  function resolveAutoPrinter(sizeId: string): string | null {
    const base = sizeId.replace(/^sticker-/, "");
    const rule = AUTO_PRINTER_BY_SIZE[base];
    if (rule) {
      const onThatPc = printers.filter((p) => p.pc === rule.pc && (!rule.modelHint || p.name.toLowerCase().includes(rule.modelHint)));
      const match = onThatPc.find((p) => p.online) ?? onThatPc[0];
      if (match) return match.id;
    }
    return printers.find((p) => p.online)?.id ?? null;
  }
  function printerLabelFor(sizeId: string): string {
    const id = printerOverride || resolveAutoPrinter(sizeId);
    const p = printers.find((x) => x.id === id);
    return p ? `${p.pc}${p.online ? "" : " (offline)"}` : "no printer online";
  }

  // Designs are per-size, not per-SKU — fetch all of them once up front so
  // every thumbnail can render as soon as a SKU is picked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        sizes.map(async (s) => {
          try {
            const r = await fetch(`/api/erp/labels/design?sizeId=${encodeURIComponent(s.id)}`, { cache: "no-store" });
            const d = await r.json();
            return [s.id, (d?.design?.approved_doc as LabelDoc) ?? null] as const;
          } catch { return [s.id, null] as const; }
        }),
      );
      if (!cancelled) setDocsBySize(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes.map((s) => s.id).join(",")]);

  // Fetch the chosen SKU's data + inventory locations; auto-pick the highest-qty one.
  useEffect(() => {
    if (skuValue == null) { setData(null); return; }
    let cancelled = false;
    setLoadingData(true); setMsg(null);
    (async () => {
      const d = await fetchSkuData(skuValue);
      if (cancelled) return;
      setData(d);
      setLotIdx(0);
      setLot(d?.locations[0]?.batch ?? "");
      setRack(d?.locations[0]?.rack ?? "");
      setLoadingData(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuValue]);

  // Picking a different lot from the dropdown swaps rack to match it exactly.
  function pickLot(idx: number) {
    setLotIdx(idx);
    const loc = data?.locations[idx];
    setLot(loc?.batch ?? "");
    setRack(loc?.rack ?? "");
  }

  const fill: LabelFill | null = useMemo(() => {
    if (!data) return null;
    const base: LabelFill = {
      sku_code: data.sku_code, name: data.name, header: data.header, price: data.price,
      unit: data.unit, singleQty: data.singleQty, masterQty: data.masterQty, tier,
      lot, rack, pkd: data.pkd,
      qrSvg: tier === "master" ? (data.qrSvgMaster ?? data.qrSvgSingle) : data.qrSvgSingle,
      qrMatrix: tier === "master" ? (data.qrMatrixMaster ?? data.qrMatrixSingle) : data.qrMatrixSingle,
    };
    return { ...base, ...(extendFill ? extendFill(data) : {}) };
  }, [data, lot, rack, tier, extendFill]);

  // Live-render every size's thumbnail whenever the fill (SKU/lot/rack) or the
  // designs change — this is the "photo of the label" the operator clicks.
  useEffect(() => {
    if (!fill) return;
    let cancelled = false;
    (async () => {
      for (const s of sizes) {
        const doc = docsBySize[s.id];
        const cv = canvasRefs.current[s.id];
        if (!doc || !cv) continue;
        const dp = 4; // screen-preview scale, not printer resolution
        cv.width = Math.round(doc.w * dp);
        cv.height = Math.round(doc.h * dp);
        const ctx = cv.getContext("2d");
        if (!ctx) continue;
        await ensureFontsLoaded(doc);
        if (cancelled) return;
        await renderDoc(ctx, doc, fill, dp);
      }
    })();
    return () => { cancelled = true; };
  }, [fill, docsBySize, sizes]);

  async function handlePrint(sizeId: string) {
    const doc = docsBySize[sizeId];
    if (!doc || !data || !fill || printingSizeId) return;
    const printerId = printerOverride || resolveAutoPrinter(sizeId);
    if (!printerId) { setMsg({ ok: false, text: "No printer online — pick one below or start the print agent." }); return; }
    setPrintingSizeId(sizeId); setMsg(null);
    try {
      const res = await onPrint(data, sizeId, doc, fill, copies, printerId);
      setMsg(res);
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally { setPrintingSizeId(null); }
  }

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-4">
      <section className="panel">
        <div className="panel-hd">1 · SKU, lot &amp; copies</div>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex min-w-[280px] flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Item
            <SearchSelect options={skuOptions} value={skuValue} onChange={setSkuValue} placeholder="Search SKU code or name…" className={inp} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Lot No
            <input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="—" className={`${inp} w-32`} />
          </label>
          {data && data.locations.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Pick a location
              <select value={lotIdx} onChange={(e) => pickLot(Number(e.target.value))} className={inp}>
                {data.locations.map((l, i) => (
                  <option key={i} value={i}>{l.batch || "(no lot)"} — {l.rack || "no rack"} · qty {l.qty}</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Rack
            <input value={rack} onChange={(e) => setRack(e.target.value)} placeholder="picked automatically" className={`${inp} w-32`} />
          </label>
          <div className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Label Type
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
              {(["single", "master"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTier(t)} className={`px-3 py-2 text-sm font-bold ${tier === t ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)]"}`}>
                  {t === "single" ? "Single" : "Master"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Copies
            <input type="number" min={1} value={copies} onChange={(e) => setCopies(Math.max(1, Math.round(Number(e.target.value)) || 1))} className={`${inp} w-20`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--muted)]">Printer
            <select value={printerOverride} onChange={(e) => setPrinterOverride(e.target.value)} className={inp}>
              <option value="">Auto — picks the right printer per size</option>
              {printers.map((p) => <option key={p.id} value={p.id}>{p.pc}{p.online ? "" : " (offline)"}</option>)}
            </select>
          </label>
          {loadingData && <span className="text-xs text-[var(--muted)]">Loading…</span>}
          {data && data.locations.length === 0 && <span className="text-xs font-semibold text-[var(--warn,#b45309)]">No current stock location for this SKU — rack left blank, printing still works.</span>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-hd">2 · Click the size to print</div>
        <div className="flex flex-wrap gap-4 p-4">
          {sizes.map((s) => {
            const doc = docsBySize[s.id];
            const busy = printingSizeId === s.id;
            if (!doc) {
              return (
                <div key={s.id} className="flex w-[160px] flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-3 text-center opacity-50">
                  <div className="flex h-24 w-full items-center justify-center rounded-lg bg-[var(--surface-2)] text-xs text-[var(--muted)]">Not designed yet</div>
                  <div className="text-xs font-semibold text-[var(--muted)]">{s.label}</div>
                </div>
              );
            }
            return (
              <button
                key={s.id}
                type="button"
                disabled={!data || !!printingSizeId}
                onClick={() => handlePrint(s.id)}
                className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center transition hover:border-[var(--accent)] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
                title={data ? `Print on ${s.label}` : "Pick a SKU first"}
              >
                <canvas ref={(el) => { canvasRefs.current[s.id] = el; }} className="rounded border border-[var(--border)] bg-white" style={{ maxWidth: 220, maxHeight: 160 }} />
                <div className="text-xs font-semibold">{s.label}</div>
                <div className="text-[10px] text-[var(--muted)]">→ {printerLabelFor(s.id)}</div>
                {busy && <div className="text-xs text-[var(--accent)]">Printing…</div>}
              </button>
            );
          })}
        </div>
        {msg && <div className="px-4 pb-4 text-sm font-bold" style={{ color: msg.ok ? "var(--accent-2)" : "var(--danger)" }}>{msg.text}</div>}
      </section>
    </div>
  );
}
