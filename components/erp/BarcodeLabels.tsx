"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LabelAligner, { type Layout } from "./LabelAligner";
import LabelSizePicker from "./LabelSizePicker";

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
  { id: "green-65x35", label: "Green · 65 × 35 mm", w: 65, h: 35 },
  { id: "med-70x40", label: "Medium green · 70 × 40 mm", w: 70, h: 40 },
  { id: "small-50x30", label: "Small green · 50 × 30 mm", w: 50, h: 30 },
  { id: "custom", label: "Custom…", w: 0, h: 0 },
];

export default function BarcodeLabels({ items }: { items: Item[] }) {
  const [labels, setLabels] = useState<Record<number, Label>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [type, setType] = useState<Record<number, LabelType>>({});
  const [copies, setCopies] = useState(1);
  const [mode, setMode] = useState<"sheet" | "roll" | "a4tiled" | "a4land">("roll");
  // A4 sheet packing: page margin + gap between labels. Defaults match the
  // original layout; dropping them fits noticeably more per sheet.
  const [sheetMargin, setSheetMargin] = useState(8);
  const [sheetGap, setSheetGap] = useState(3);
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

  // PrintNode: the TSC label printers on the ERP PCs, fetched via our server
  // proxy (API key stays server-side). This is the reliable print path.
  const [pnPrinters, setPnPrinters] = useState<{ id: number; name: string; state: string; computer: string }[]>([]);
  const [pnPrinterId, setPnPrinterId] = useState<number | null>(null);
  const [pnBusy, setPnBusy] = useState(false);
  const [pnLoading, setPnLoading] = useState(false);
  const [pnMsg, setPnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Print engine: PrintNode (default) or our self-hosted bridge (an agent on each
  // ERP PC). The bridge lists printers agents have heartbeated; jobs go via a queue.
  const [engine, setEngine] = useState<"printnode" | "bridge">("printnode");
  const [brPrinters, setBrPrinters] = useState<{ id: string; pc: string; name: string; online: boolean; code?: string; labelSize?: string; locked?: boolean }[]>([]);
  const [brPrinterId, setBrPrinterId] = useState<string | null>(null);
  useEffect(() => { try { const e = localStorage.getItem("erp_print_engine"); if (e === "bridge" || e === "printnode") setEngine(e); } catch { /* default */ } }, []);
  // A bridge printer locked to a size forces that size the moment it's selected.
  useEffect(() => {
    if (engine !== "bridge") return;
    const p = brPrinters.find((x) => x.id === brPrinterId);
    if (p?.locked && p.labelSize) setSizeId(p.labelSize);
  }, [engine, brPrinterId, brPrinters]);
  // Print-quality knobs for the QR (printer/media specific). Darkness = TSPL
  // DENSITY 1–15; slower speed = crisper modules. Persisted locally.
  const [density, setDensity] = useState(8);
  const [speed, setSpeed] = useState(2);
  useEffect(() => {
    try {
      const dv = Number(localStorage.getItem("erp_label_density")); if (dv >= 1 && dv <= 15) setDensity(dv);
      const sv = Number(localStorage.getItem("erp_label_speed")); if (sv >= 1) setSpeed(sv);
    } catch { /* defaults */ }
  }, []);
  // Shared per-size alignment (visual aligner) — applied automatically on print.
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [alignOpen, setAlignOpen] = useState(false);
  useEffect(() => {
    fetch("/api/erp/labels/layout").then((r) => r.json()).then((d) => { if (d.ok) setLayouts(d.layouts || {}); }).catch(() => {});
  }, []);
  // Per-SKU print name overrides (with manual line breaks). Shared across PCs.
  const [labelNames, setLabelNames] = useState<Record<string, string>>({});
  // Label Master (structured Line 1/2/3 + units/lot/rack per SKU) — takes precedence on print.
  const [labelMaster, setLabelMaster] = useState<Record<string, { line1: string; line2: string; line3: string; units: string; lot: string; rack: string }>>({});
  useEffect(() => {
    fetch("/api/erp/labels/master").then((r) => r.json()).then((d) => { if (d.ok) setLabelMaster(d.master || {}); }).catch(() => {});
  }, []);
  const [nameEdit, setNameEdit] = useState<{ code: string; value: string } | null>(null);
  useEffect(() => {
    fetch("/api/erp/labels/names").then((r) => r.json()).then((d) => { if (d.ok) setLabelNames(d.names || {}); }).catch(() => {});
  }, []);
  async function saveLabelNameEdit() {
    if (!nameEdit) return;
    const code = nameEdit.code, value = nameEdit.value;
    await fetch("/api/erp/labels/names", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ skuCode: code, name: value }) }).catch(() => {});
    const clean = value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 3).join("\n");
    setLabelNames((m) => { const c = { ...m }; if (clean) c[code] = clean; else delete c[code]; return c; });
    setNameEdit(null);
  }
  // Switch this size between the two label templates (Design 1 / Design 2). Saved to
  // the (protected) layouts table so the choice is locked and never resets.
  async function setLabelDesign(d: number) {
    setLayouts((m) => ({ ...m, [sizeId]: { ...(m[sizeId] ?? { offsetX: 0, offsetY: 0, qrMM: 0 }), design: d } }));
    // designOnly = change ONLY the template; never sends elements/offsets, so it can
    // never overwrite a size's saved alignment (even if local state is stale).
    await fetch("/api/erp/labels/layout", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sizeId, design: d, designOnly: true }),
    }).catch(() => {});
  }
  const loadPrinters = useCallback(async () => {
    setPnLoading(true);
    try {
      const r = await fetch("/api/erp/labels/printnode/printers", { cache: "no-store" });
      const d = await r.json();
      if (d.ok && Array.isArray(d.printers)) {
        setPnPrinters(d.printers);
        const online = d.printers.find((p: { state: string }) => p.state === "online");
        setPnPrinterId((prev) => prev ?? (online?.id ?? d.printers[0]?.id ?? null));
      }
    } catch { /* PrintNode not configured */ }
    // Bridge printers (agents that have heartbeated).
    try {
      const rb = await fetch("/api/erp/print/printers", { cache: "no-store" });
      const db = await rb.json();
      if (db.ok && Array.isArray(db.printers)) {
        setBrPrinters(db.printers);
        const on = db.printers.find((p: { online: boolean }) => p.online);
        setBrPrinterId((prev) => prev ?? (on?.id ?? db.printers[0]?.id ?? null));
      }
    } catch { /* bridge not configured */ }
    finally { setPnLoading(false); }
  }, []);
  // load once + re-check status every 15s so online/offline stays live
  useEffect(() => {
    loadPrinters();
    const t = setInterval(loadPrinters, 15000);
    return () => clearInterval(t);
  }, [loadPrinters]);

  // Each ERP PC keeps ONE label roll, so remember the size per PC and switch to
  // it automatically when that printer is picked. Seeded with the known mapping.
  const sizeByComputer = useRef<Record<string, string>>({ "DESKTOP-U8693H8": "big-95x70" });
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("erp_label_size_by_computer") || "{}");
      sizeByComputer.current = { "DESKTOP-U8693H8": "big-95x70", ...stored };
    } catch { /* keep seed */ }
  }, []);
  // when the selected printer changes, switch to that PC's remembered label size
  useEffect(() => {
    const sel = pnPrinters.find((p) => p.id === pnPrinterId);
    const mapped = sel && sizeByComputer.current[sel.computer];
    if (mapped && LABEL_SIZES.some((s) => s.id === mapped)) setSizeId(mapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnPrinterId]);

  const roll = mode === "roll";
  // Both A4-tiled modes share the same tiling/layout; only the page orientation
  // (and therefore how many fit) differs. Landscape is a separate option so the
  // existing portrait sheet keeps behaving exactly as before.
  const landscape = mode === "a4land";
  const a4 = mode === "a4tiled" || landscape;
  const dims = useMemo(() => {
    if (sizeId === "custom") return { w: Math.max(10, customW || 10), h: Math.max(10, customH || 10) };
    return LABEL_SIZES.find((s) => s.id === sizeId) ?? { w: 70, h: 40 };
  }, [sizeId, customW, customH]);
  // How many of the chosen die-cut fit on one A4 page (8mm margins, 3mm gap).
  // Portrait = 210×297; landscape swaps to 297×210.
  const perPage = useMemo(() => {
    const pw = landscape ? 297 : 210;
    const ph = landscape ? 210 : 297;
    const m = Math.max(0, sheetMargin), g = Math.max(0, sheetGap);
    const cols = Math.max(1, Math.floor((pw - 2 * m + g) / (dims.w + g)));
    const rows = Math.max(1, Math.floor((ph - 2 * m + g) / (dims.h + g)));
    return cols * rows;
  }, [dims, landscape, sheetMargin, sheetGap]);
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
    // Precedence: Label Master (structured lines) → per-SKU name override → SKU name.
    const m = labelMaster[l.sku_code];
    const masterName = m ? [m.line1, m.line2, m.line3].filter(Boolean).join("\n") : "";
    const name = masterName || labelNames[l.sku_code] || l.name;
    const lot = m?.lot || l.lot;
    const rack = m?.rack || l.rack;
    const unit = m?.units || l.unit;
    return Array.from({ length: Math.max(1, copies) }, (_, n) => ({ ...l, name, lot, rack, unit, type: t, qrToken, qrSvg, key: `${i.id}-${t}-${n}` }));
  });

  const labelStyle = (roll || a4) ? { width: `${dims.w}mm`, height: `${dims.h}mm` } : undefined;

  // Print directly to a TSC label printer via PrintNode (raw TSPL, one job/label).
  async function printToTsc() {
    if (!pnPrinterId || printable.length === 0) return;
    setPnBusy(true); setPnMsg(null);
    try {
      const r = await fetch("/api/erp/labels/printnode", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          printerId: pnPrinterId, w: dims.w, h: dims.h,
          // which end the pre-printed address sits on, so the print lands in the
          // white half; dpi (203 for TTP-244, 300 for TTP-345) so coordinates map
          // to the printer's real resolution instead of squashing into a corner
          layout: {
            pos: contentPos,
            dpi: /34\d|300\s*dpi/i.test(pnPrinters.find((p) => p.id === pnPrinterId)?.name ?? "") ? 300 : 203,
            density, speed,
            offsetXmm: layouts[sizeId]?.offsetX ?? 0,
            offsetYmm: layouts[sizeId]?.offsetY ?? 0,
            qrMM: layouts[sizeId]?.qrMM ?? 0,
            elements: layouts[sizeId]?.elements ?? {},
            design: layouts[sizeId]?.design ?? 1,
          },
          labels: printable.map((l) => ({
            sku_code: l.sku_code, qrToken: l.qrToken, name: l.name, type: l.type,
            masterQty: l.masterQty, singleQty: l.singleQty, unit: l.unit, price: l.price,
            lot: l.lot, rack: l.rack, pkd: l.pkd,
          })),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setPnMsg({ ok: true, text: `Sent ${d.sent} label${d.sent === 1 ? "" : "s"} — confirming print…` });
        fetch("/api/erp/labels/log-print", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ skuCodes: [...new Set(printable.map((l) => l.sku_code))], labelCount: printable.length }),
        }).catch(() => {});
        // Confirm the jobs actually printed (catches the "accepted but printer
        // asleep/offline" phantom-queue case).
        const ids: number[] = (d.results || []).filter((x: { ok: boolean }) => x.ok).map((x: { job: unknown }) => Number(x.job)).filter((n: number) => Number.isFinite(n));
        verifyPrint(ids, d.sent);
      } else setPnMsg({ ok: false, text: d.error || "Print failed." });
    } catch (e) {
      setPnMsg({ ok: false, text: String(e) });
    } finally { setPnBusy(false); }
  }

  // Poll PrintNode job states a couple of times; report whether paper moved.
  async function verifyPrint(ids: number[], sent: number) {
    if (ids.length === 0) return;
    for (const wait of [2500, 3500]) {
      await new Promise((res) => setTimeout(res, wait));
      try {
        const r = await fetch("/api/erp/labels/printnode/status", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }),
        });
        const d = await r.json();
        if (!d.ok) continue;
        const vals = Object.values(d.states || {}) as string[];
        const printed = vals.filter((v) => v === "done" || v === "in_progress").length;
        if (printed >= ids.length) { setPnMsg({ ok: true, text: `✓ Printed ${sent} label${sent === 1 ? "" : "s"} — confirmed on the printer.` }); return; }
      } catch { /* retry */ }
    }
    setPnMsg({ ok: false, text: `⚠ Sent to PrintNode but the printer didn't confirm printing — it may be asleep/offline or out of labels. Check it and reprint.` });
  }

  // Print via our own bridge: enqueue jobs, then poll the queue for done/failed.
  async function printToBridge() {
    if (!brPrinterId || printable.length === 0) return;
    // Enforce the printer↔size lock.
    const bp = brPrinters.find((x) => x.id === brPrinterId);
    if (bp?.locked && bp.labelSize && sizeId !== bp.labelSize) {
      setPnMsg({ ok: false, text: `🔒 ${bp.code || bp.name} is locked to ${LABEL_SIZES.find((s) => s.id === bp.labelSize)?.label ?? bp.labelSize} — select that size or unlock the printer.` });
      return;
    }
    setPnBusy(true); setPnMsg(null);
    try {
      const r = await fetch("/api/erp/labels/bridge", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          printerId: brPrinterId, w: dims.w, h: dims.h,
          layout: {
            pos: contentPos, density, speed,
            offsetXmm: layouts[sizeId]?.offsetX ?? 0,
            offsetYmm: layouts[sizeId]?.offsetY ?? 0,
            qrMM: layouts[sizeId]?.qrMM ?? 0,
            elements: layouts[sizeId]?.elements ?? {},
            design: layouts[sizeId]?.design ?? 1,
          },
          labels: printable.map((l) => ({
            sku_code: l.sku_code, qrToken: l.qrToken, name: l.name, type: l.type,
            masterQty: l.masterQty, singleQty: l.singleQty, unit: l.unit, price: l.price,
            lot: l.lot, rack: l.rack, pkd: l.pkd,
          })),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setPnMsg({ ok: true, text: `Queued ${d.queued} label${d.queued === 1 ? "" : "s"} — printing…` });
        fetch("/api/erp/labels/log-print", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ skuCodes: [...new Set(printable.map((l) => l.sku_code))], labelCount: printable.length }),
        }).catch(() => {});
        verifyBridge(d.ids || []);
      } else setPnMsg({ ok: false, text: d.error || "Print failed." });
    } catch (e) { setPnMsg({ ok: false, text: String(e) }); }
    finally { setPnBusy(false); }
  }

  async function verifyBridge(ids: number[]) {
    if (!ids.length) return;
    for (const wait of [1800, 2500, 4000]) {
      await new Promise((res) => setTimeout(res, wait));
      try {
        const r = await fetch("/api/erp/labels/bridge/status", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }),
        });
        const d = await r.json();
        if (!d.ok) continue;
        const vals = Object.values(d.statuses || {}) as { status: string }[];
        const failed = vals.filter((v) => v.status === "failed").length;
        const done = vals.filter((v) => v.status === "done").length;
        if (failed) { setPnMsg({ ok: false, text: `✕ ${failed} label${failed === 1 ? "" : "s"} failed at the printer (agent error). Check the printer/agent.` }); return; }
        if (done >= ids.length) { setPnMsg({ ok: true, text: `✓ Printed ${ids.length} label${ids.length === 1 ? "" : "s"} — confirmed by the agent.` }); return; }
      } catch { /* retry */ }
    }
    setPnMsg({ ok: false, text: `⚠ Queued but no confirmation yet — is the print agent running on that PC? It'll print as soon as the agent picks it up.` });
  }

  // Exact-size PDF (one label per page, page = the die-cut). Printing this at
  // "Actual size" is far more reliable than the browser's HTML print.
  async function downloadPdf(sheet?: "a4") {
    if (printable.length === 0) return;
    const payload = {
      labels: printable.map((l) => ({
        sku_code: l.sku_code, qrToken: l.qrToken, name: l.name, type: l.type,
        masterQty: l.masterQty, singleQty: l.singleQty, unit: l.unit, price: l.price,
        lot: l.lot, rack: l.rack, pkd: l.pkd,
      })),
      // The A4 die sheet is always a full white label (own address); the per-die
      // PDF respects the pre-printed toggle.
      w: dims.w, h: dims.h, preprinted: sheet === "a4" ? false : preprinted, contentPos, sheet,
      landscape: sheet === "a4" ? landscape : false,
      margin: sheetMargin, gap: sheetGap,
    };
    const r = await fetch("/api/erp/labels/pdf", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${sheet === "a4" ? (landscape ? "labels-a4-landscape" : "labels-a4") : "labels"}-${dims.w}x${dims.h}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const renderSheet = () => (
    <div className={
      roll ? "flex flex-col items-start gap-3"
      : a4 ? "a4-grid"
      : "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
    }>
      {loading && <p className="text-sm text-[var(--muted)]">Generating QR codes…</p>}
      {!loading && printable.map((l) => {
        // A4-tiled sheet always prints a full black-on-WHITE label (own address,
        // white bg, cut guide) — the whole point is a crisp high-contrast QR to
        // test-scan on plain paper/sticker. Never the transparent pre-printed look.
        const showFull = a4 ? true : !preprinted;
        const label = (
        <div style={labelStyle}
          className={`barcode-label ${l.type === "master" && !a4 ? "master" : ""} ${roll || a4 ? "thermal" : ""} ${a4 ? "a4label" : ""} ${rotate && roll ? "rot" : ""} ${!showFull ? "preprinted" : ""} pos-${contentPos}`}>
          <div className="bl-row">
            <div className="bl-qr-main">
              <div dangerouslySetInnerHTML={{ __html: l.qrSvg }} />
              <span className="bl-qr-token">{l.qrToken}</span>
            </div>
            <div className="bl-body">
              <div className="bl-sku">{l.sku_code}</div>
              <div className="bl-name">{String(l.name).split("\n").map((ln, i) => <div key={i}>{ln}</div>)}</div>
              <div className="bl-qty">
                {l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`}
                {" · "}MRP.Rs.{l.price.toFixed(0)}/-
              </div>
              {showFull && <div className="bl-tax">(Incl. of All Taxes)</div>}
            </div>
          </div>
          {/* Company address is skipped on pre-printed stock (it's already on the label). */}
          {showFull && (
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
        // In A4 mode each label is an inline-block tile that wraps + paginates.
        return roll ? (
          <div key={l.key} className="label-rot" style={{ width: `${pageW}mm`, height: `${pageH}mm` }}>{label}</div>
        ) : a4 ? (
          <div key={l.key} className="a4-tile">{label}</div>
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
      {/* A4-tiled test sheet: force a normal A4 page so many labels tile per page. */}
      {a4 && (
        <style dangerouslySetInnerHTML={{ __html: `.a4-tile { margin: 0 ${sheetGap}mm ${sheetGap}mm 0 !important; } @media print { @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: ${sheetMargin}mm; } }` }} />
      )}

      {/* visual size picker — pick the stock by its look */}
      {(roll || a4) && (
        <div className="no-print rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <LabelSizePicker value={sizeId} onChange={(v) => {
            setSizeId(v);
            const sel = pnPrinters.find((p) => p.id === pnPrinterId);
            if (sel && v !== "custom") {
              sizeByComputer.current[sel.computer] = v;
              try { localStorage.setItem("erp_label_size_by_computer", JSON.stringify(sizeByComputer.current)); } catch { /* ignore */ }
            }
          }} />
        </div>
      )}

      {/* thin bar: choose which of the two label templates to print for this size */}
      {(roll || a4) && sizeId !== "custom" && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-bold text-[var(--muted)]">Label design:</span>
          {[1, 2].map((d) => (
            <button key={d} onClick={() => setLabelDesign(d)}
              className={`rounded-md border px-3 py-1 font-bold ${(layouts[sizeId]?.design ?? 1) === d
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] bg-white hover:bg-[var(--surface)]"}`}>
              Label {d}{d === 2 ? " · Classic" : ""}
            </button>
          ))}
          <span className="ml-auto text-xs text-[var(--muted-2)]">🔒 Saved &amp; locked — never resets</span>
        </div>
      )}

      {/* toolbar */}
      <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <button onClick={() => setSelected(new Set(items.map((i) => i.id)))} className={btn}>Select all</button>
        <button onClick={() => setSelected(new Set())} className={btn}>Clear</button>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
          <button onClick={() => setMode("roll")} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${roll ? "bg-[var(--accent)] text-white" : ""}`}>Thermal roll</button>
          <button onClick={() => setMode("sheet")} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${mode === "sheet" ? "bg-[var(--accent)] text-white" : ""}`}>A4 sheet</button>
          <button onClick={() => setMode("a4tiled")} className={`rounded-md px-2.5 py-1 text-sm font-semibold ${mode === "a4tiled" ? "bg-[var(--accent)] text-white" : ""}`}>A4 × label size</button>
          <button onClick={() => setMode("a4land")} title="Same A4 tiling, but the sheet prints sideways (297×210) — often fits more labels per page" className={`rounded-md px-2.5 py-1 text-sm font-semibold ${landscape ? "bg-[var(--accent)] text-white" : ""}`}>A4 landscape</button>
        </div>

        {a4 && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1" title="Smaller page margin and gap fit more labels per sheet. 5mm margin + 0mm gap is usually the tightest most printers manage.">
            <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)]">
              Margin
              <input type="number" min={0} max={20} step={1} value={sheetMargin}
                onChange={(e) => setSheetMargin(Math.max(0, Number(e.target.value) || 0))}
                className="w-14 rounded border border-[var(--border)] px-1.5 py-0.5 text-sm" />mm
            </label>
            <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)]">
              Gap
              <input type="number" min={0} max={20} step={1} value={sheetGap}
                onChange={(e) => setSheetGap(Math.max(0, Number(e.target.value) || 0))}
                className="w-14 rounded border border-[var(--border)] px-1.5 py-0.5 text-sm" />mm
            </label>
            <button onClick={() => { setSheetMargin(5); setSheetGap(0); }} className="rounded-md border border-[var(--accent)] px-2 py-0.5 text-xs font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]" title="Tightest practical packing — 5mm margin, no gap">Pack tight</button>
            <span className="text-xs font-bold tabular-nums text-[var(--accent)]">{perPage}/page</span>
          </div>
        )}

        {(roll || a4) && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            Label size
            <select value={sizeId} onChange={(e) => {
              const v = e.target.value;
              setSizeId(v);
              // remember this size for the selected printer's PC
              const sel = pnPrinters.find((p) => p.id === pnPrinterId);
              if (sel && v !== "custom") {
                sizeByComputer.current[sel.computer] = v;
                try { localStorage.setItem("erp_label_size_by_computer", JSON.stringify(sizeByComputer.current)); } catch { /* ignore */ }
              }
            }}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
              {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        {roll && (
          <button onClick={() => setAlignOpen(true)} title="Fine-tune this size's alignment (nudge / resize), on top of the current layout"
            className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)]">
            🎯 Align{(layouts[sizeId]?.offsetX || layouts[sizeId]?.offsetY || layouts[sizeId]?.qrMM || (layouts[sizeId]?.elements && Object.keys(layouts[sizeId].elements!).length)) ? " ✓" : ""}
          </button>
        )}
        {roll && (
          <a href="/erp/masters/label" title="Control how each part's name breaks into lines"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">
            🏷️ Label text
          </a>
        )}
        {(roll || a4) && sizeId === "custom" && (
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
            onClick={() => downloadPdf()}
            disabled={loading || printable.length === 0}
            title="Download an exact-size PDF (one label per page). Print it at Actual size — far more reliable than the browser print."
            className="ml-auto rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)] disabled:opacity-50"
          >
            ⤓ PDF ({dims.w}×{dims.h})
          </button>
        )}
        {a4 && (
          <button
            onClick={() => downloadPdf("a4")}
            disabled={loading || printable.length === 0}
            title="Exact-size A4 PDF die layout with cut lines. Open it and print at 100% / Actual size — guaranteed exact physical size, unlike the browser HTML print."
            className="ml-auto rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)] disabled:opacity-50"
          >
            ⤓ A4{landscape ? " landscape" : ""} PDF die ({dims.w}×{dims.h})
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

      {/* Direct print to a TSC label printer via PrintNode — the reliable path */}
      {roll && (
        <div className="no-print rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-bg)] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold text-[var(--accent-strong)]">🏷️ Print to label printer</span>
            <div className="ml-1 inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-xs font-bold">
              <button onClick={() => { setEngine("printnode"); try { localStorage.setItem("erp_print_engine", "printnode"); } catch { /* ignore */ } }}
                className={`px-2.5 py-1 ${engine === "printnode" ? "bg-[var(--accent)] text-white" : "bg-white hover:bg-[var(--surface-2)]"}`}>PrintNode</button>
              <button onClick={() => { setEngine("bridge"); try { localStorage.setItem("erp_print_engine", "bridge"); } catch { /* ignore */ } }}
                className={`px-2.5 py-1 ${engine === "bridge" ? "bg-[var(--accent)] text-white" : "bg-white hover:bg-[var(--surface-2)]"}`}>Direct (our bridge)</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              Printer
              {engine === "printnode" ? (
                <select value={pnPrinterId ?? ""} onChange={(e) => setPnPrinterId(Number(e.target.value) || null)}
                  className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-sm">
                  {pnPrinters.length === 0 && <option value="">No printers found</option>}
                  {pnPrinters.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.state !== "online"}>
                      {p.state === "online" ? "🟢" : "🔴"} {p.computer} · {p.name}{p.state !== "online" ? " (offline)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={brPrinterId ?? ""} onChange={(e) => setBrPrinterId(e.target.value || null)}
                  className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-sm">
                  {brPrinters.length === 0 && <option value="">No agents online</option>}
                  {brPrinters.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.online}>
                      {p.online ? "🟢" : "🔴"} {p.code ? `${p.code} · ` : ""}{p.pc} · {p.name}
                      {p.locked && p.labelSize ? ` 🔒 ${LABEL_SIZES.find((s) => s.id === p.labelSize)?.label ?? p.labelSize}` : ""}
                      {!p.online ? " (offline)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {(() => {
              const on = engine === "printnode"
                ? pnPrinters.find((p) => p.id === pnPrinterId)?.state === "online"
                : !!brPrinters.find((p) => p.id === brPrinterId)?.online;
              const has = engine === "printnode" ? pnPrinters.some((p) => p.id === pnPrinterId) : brPrinters.some((p) => p.id === brPrinterId);
              if (!has) return null;
              return (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${on ? "bg-[var(--accent-2-bg)] text-[var(--accent-2)]" : "bg-[var(--danger-bg)] text-[var(--danger)]"}`}>
                  <span className={`h-2 w-2 rounded-full ${on ? "bg-[var(--accent-2)]" : "bg-[var(--danger)]"}`} />{on ? "Online" : "Offline"}
                </span>
              );
            })()}
            <button onClick={loadPrinters} disabled={pnLoading} title="Re-check printer status"
              className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-bold hover:bg-[var(--surface-2)] disabled:opacity-50">
              {pnLoading ? "…" : "↻ Refresh"}
            </button>
            <span className="text-sm font-semibold text-[var(--muted)]">at {dims.w} × {dims.h} mm</span>
            <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)]" title="QR darkness (TSPL DENSITY 1–15). Too high = modules bleed/merge; too low = faint/broken. Tune for the sharpest scan.">
              🖨 Darkness
              <input type="number" min={1} max={15} value={density}
                onChange={(e) => { const v = Math.max(1, Math.min(15, Number(e.target.value) || 8)); setDensity(v); try { localStorage.setItem("erp_label_density", String(v)); } catch { /* ignore */ } }}
                className="w-14 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)]" title="Print speed — slower prints crisper QR modules (better scanning).">
              Speed
              <select value={speed} onChange={(e) => { const v = Number(e.target.value); setSpeed(v); try { localStorage.setItem("erp_label_speed", String(v)); } catch { /* ignore */ } }}
                className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm">
                <option value={2}>Slow (best)</option>
                <option value={3}>Normal</option>
                <option value={4}>Fast</option>
              </select>
            </label>
            {(() => {
              const hasPrinter = engine === "printnode" ? !!pnPrinterId : !!brPrinterId;
              const offline = engine === "printnode"
                ? (!!pnPrinterId && pnPrinters.find((p) => p.id === pnPrinterId)?.state !== "online")
                : (!!brPrinterId && !brPrinters.find((p) => p.id === brPrinterId)?.online);
              return (
                <button onClick={engine === "bridge" ? printToBridge : printToTsc}
                  disabled={pnBusy || !hasPrinter || printable.length === 0 || offline}
                  title={offline ? "This printer is offline — start the PC/agent/printer first" : ""}
                  className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50">
                  {pnBusy ? "Printing…" : offline ? "Printer offline" : `Print ${printable.length} to printer`}
                </button>
              );
            })()}
          </div>
          {engine === "printnode" && pnPrinters.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {pnPrinters.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 font-semibold text-[var(--muted)]">
                  <span className={`h-2 w-2 rounded-full ${p.state === "online" ? "bg-[var(--accent-2)]" : "bg-[var(--danger)]"}`} />
                  {p.computer} · {p.name} — <span className={p.state === "online" ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}>{p.state === "online" ? "online" : "offline"}</span>
                </span>
              ))}
            </div>
          )}
          {engine === "bridge" && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {brPrinters.length === 0
                ? <span className="font-semibold text-[var(--muted)]">No print agents online — start the agent on the ERP PC (see <code>agent/README.md</code>).</span>
                : brPrinters.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 font-semibold text-[var(--muted)]">
                    <span className={`h-2 w-2 rounded-full ${p.online ? "bg-[var(--accent-2)]" : "bg-[var(--danger)]"}`} />
                    {p.pc} · {p.name} — <span className={p.online ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}>{p.online ? "online" : "offline"}</span>
                  </span>
                ))}
            </div>
          )}
          {pnMsg && <div className={`mt-2 text-sm font-bold ${pnMsg.ok ? "text-[var(--accent-2)]" : "text-[var(--danger)]"}`}>{pnMsg.ok ? "✓ " : "✕ "}{pnMsg.text}</div>}
        </div>
      )}
      {roll && (
        <p className="no-print -mt-1 text-xs text-[var(--muted)]">
          Pick the <b>printer</b> (each ERP PC = one label size) + the matching <b>Label size</b>, tick your SKUs, and hit
          <b> Print to printer</b> — it goes straight to the TSC. The <b>⤓ PDF</b> / <b>🖨 Print</b> buttons above are backups.
        </p>
      )}
      {a4 && (
        <p className="no-print -mt-1 text-xs text-[var(--muted)]">
          <b>A4 die sheet ({landscape ? "landscape 297×210" : "portrait 210×297"}):</b> tiles your <b>{dims.w}×{dims.h} mm</b> label across A4 (<b>~{perPage} per page</b>) — switch between <b>A4 × label size</b> and <b>A4 landscape</b> and watch this number to see which fits more for this size,
          black-on-white with cut lines. For <b>exact physical size</b> use <b>⤓ A4 PDF die</b> (points-based — prints true size,
          unlike the browser) → open it and print at <b>100% / Actual size</b> on <b>matte white</b> sticker/paper. The <b>🖨 Print</b> button is the quick preview.
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

      {/* Per-SKU print name / line-break editor for the selected parts. */}
      {chosen.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase text-[var(--muted)]">✎ Name / line breaks:</span>
          {chosen.map((i) => (
            <button key={i.id} onClick={() => setNameEdit({ code: i.sku_code, value: labelNames[i.sku_code] ?? (labels[i.id]?.name ?? i.name) })}
              className={`rounded-lg border px-2 py-1 text-xs font-bold hover:bg-[var(--surface-2)] ${labelNames[i.sku_code] ? "border-[var(--accent)] text-[var(--accent-strong)]" : "border-[var(--border)] bg-white"}`}>
              ✎ {i.sku_code}{labelNames[i.sku_code] ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}

      {/* On-screen preview (inline). In print this is hidden — the body-level
          portal below is what actually prints. */}
      <div className={`print-area ${roll ? "roll" : a4 ? "a4sheet" : ""}`}>{renderSheet()}</div>

      {/* Print target lifted to <body> so the app chrome (sidebar/header) can't
          push labels down or add blank pages between die-cuts. */}
      {mounted && createPortal(
        <div className={`labels-print-portal print-area ${roll ? "roll" : a4 ? "a4sheet" : ""}`}>{renderSheet()}</div>,
        document.body,
      )}

      {nameEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setNameEdit(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-extrabold">✎ Print name · {nameEdit.code}</h2>
              <button onClick={() => setNameEdit(null)} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-sm font-bold hover:bg-[var(--surface-2)]">✕</button>
            </div>
            <p className="mb-2 text-xs text-[var(--muted)]">Type the name as it should print. Press <b>Enter</b> to break to a new line (up to 3). Blank = use the original name. Saved for this part, every size.</p>
            <textarea value={nameEdit.value} rows={3} autoFocus
              onChange={(e) => setNameEdit((v) => v ? { ...v, value: e.target.value } : v)}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-white p-2 font-mono text-sm leading-tight" />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setNameEdit((v) => v ? { ...v, value: "" } : v)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Clear</button>
              <button onClick={saveLabelNameEdit} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-bold text-white hover:opacity-90">Save</button>
            </div>
          </div>
        </div>
      )}

      {alignOpen && (
        <LabelAligner
          sizeId={sizeId} w={dims.w} h={dims.h}
          pos={dims.w === 85 && dims.h === 55 ? "bottom" : contentPos}
          sample={printable[0]
            ? { code: printable[0].sku_code, name: printable[0].name, qty: `Qty. ${printable[0].singleQty || 1} ${printable[0].unit}`, mrp: `MRP.Rs.${Math.round(printable[0].price)}/-` }
            : { code: "HH12006", name: "CENTER STAND KIT SPL", qty: "Qty. 1 PCS", mrp: "MRP.Rs.570/-" }}
          initial={layouts[sizeId] ?? { offsetX: 0, offsetY: 0, qrMM: 0 }}
          onClose={() => setAlignOpen(false)}
          onSaved={(l) => { setLayouts((m) => ({ ...m, [sizeId]: { ...l, design: m[sizeId]?.design ?? 1 } })); setAlignOpen(false); setPnMsg({ ok: true, text: `Alignment saved for ${dims.w}×${dims.h} mm.` }); }}
        />
      )}
    </div>
  );
}

const btn =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-2)]";
