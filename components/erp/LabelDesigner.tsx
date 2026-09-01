"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LABEL_SIZES } from "@/lib/erp/labelSizes";
import {
  type LabelDoc, type DesignEl, type ElKind, type LabelFill,
  defaultDoc, newElement, SAMPLE_FILL, FONT_GROUPS, SIZE_CHOICES_MM,
} from "@/lib/erp/labelDoc";
import { renderDoc, renderDocToTSPL, ensureFontsLoaded } from "@/lib/erp/labelRender";

type Br = { id: string; pc: string; name: string; online: boolean; code?: string };
const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sizes = LABEL_SIZES.filter((s) => s.w > 0 && s.h > 0);
const isContent = (k: ElKind) => k === "text" || k === "qr" || k === "barcode";
const rectsHit = (ax: number, ay: number, aw: number, ah: number, b: DesignEl) =>
  ax < b.x + b.w && ax + aw > b.x && ay < b.y + Math.max(b.h, 0.5) && ay + Math.max(ah, 0.5) > b.y;

export default function LabelDesigner() {
  const [sizeId, setSizeId] = useState(sizes[0]?.id ?? "big-95x70");
  const dims = useMemo(() => sizes.find((s) => s.id === sizeId) ?? { w: 70, h: 40 }, [sizeId]);
  const [doc, setDoc] = useState<LabelDoc>(() => defaultDoc(dims.w, dims.h));
  const [selId, setSelId] = useState<string | null>(null);
  const [scale, setScale] = useState(9);           // px per mm
  const [status, setStatus] = useState<"none" | "draft" | "approved">("none");
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState<LabelFill>(SAMPLE_FILL);
  const [testLong, setTestLong] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [brPrinters, setBrPrinters] = useState<Br[]>([]);
  const [brPrinterId, setBrPrinterId] = useState("");
  const [copies, setCopies] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<null | { id: string; mode: "move" | "resize"; px: number; py: number; ox: number; oy: number; ow: number; oh: number }>(null);

  const sel = doc.elements.find((e) => e.id === selId) || null;
  // Preview data: optionally force a very long name to see auto-fit shrink in action.
  const effFill: LabelFill = testLong
    ? { ...fill, name: "HYDRAULIC DISC BRAKE CALIPER ASSEMBLY FRONT-LEFT WITH MOUNTING BRACKET AND BOLTS (LONG NAME TEST)" }
    : fill;
  const docRef = useRef(doc); docRef.current = doc; // fresh doc for collision during a drag
  // would placing `id` at x,y (w×h mm) overlap another CONTENT element (text/qr/barcode)?
  const collides = (id: string, x: number, y: number, w: number, h: number) =>
    docRef.current.elements.some((e) => e.id !== id && isContent(e.kind) && rectsHit(x, y, w, h, e));
  // elements that overlap another field or spill outside the label (flagged red, block approve)
  const problems = useMemo(() => {
    const bad = new Set<string>();
    const cs = doc.elements.filter((e) => isContent(e.kind));
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (a.x < -0.01 || a.y < -0.01 || a.x + a.w > doc.w + 0.01 || a.y + a.h > doc.h + 0.01) bad.add(a.id);
      for (let j = i + 1; j < cs.length; j++) if (rectsHit(a.x, a.y, a.w, a.h, cs[j])) { bad.add(a.id); bad.add(cs[j].id); }
    }
    return bad;
  }, [doc]);
  // clamp a typed geometry value so the element stays inside the label
  const setGeom = (k: "x" | "y" | "w" | "h", val: number) => {
    if (!sel) return;
    const { x, y, w, h } = sel;
    const nv = k === "x" ? clamp(val, 0, doc.w - w) : k === "y" ? clamp(val, 0, doc.h - h)
      : k === "w" ? clamp(val, 1, doc.w - x) : clamp(val, 0, doc.h - y);
    updateSel({ [k]: nv } as Partial<DesignEl>);
  };

  // ── load design for the chosen size ───────────────────────────────────────
  const load = useCallback(async (sid: string) => {
    const s = sizes.find((x) => x.id === sid) ?? { w: 70, h: 40 };
    setMsg(null); setSelId(null);
    try {
      const r = await fetch(`/api/erp/labels/design?sizeId=${encodeURIComponent(sid)}`, { cache: "no-store" });
      const d = await r.json();
      setLocked(!!d.locked);
      const row = d.design;
      const doc0: LabelDoc = row?.draft_doc || row?.approved_doc || defaultDoc(s.w, s.h);
      doc0.w = s.w; doc0.h = s.h; // keep geometry in sync with the size
      setDoc(doc0);
      setStatus(row?.status ?? "none");
    } catch { setDoc(defaultDoc(s.w, s.h)); setStatus("none"); }
  }, []);
  useEffect(() => { load(sizeId); }, [sizeId, load]);

  // bridge printers for the test print
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/erp/print/printers", { cache: "no-store" });
        const d = await r.json();
        const list: Br[] = d.printers || d || [];
        setBrPrinters(list);
        const on = list.find((p) => p.online);
        if (on) setBrPrinterId(on.id);
      } catch { /* ignore */ }
    })();
  }, []);

  // ── render the canvas whenever the design/scale/data changes ───────────────
  useEffect(() => {
    let cancelled = false;
    const cv = canvasRef.current; if (!cv) return;
    cv.width = Math.round(doc.w * scale); cv.height = Math.round(doc.h * scale);
    const ctx = cv.getContext("2d"); if (!ctx) return;
    (async () => { await ensureFontsLoaded(doc); if (!cancelled) await renderDoc(ctx, doc, effFill, scale); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scale, fill, testLong]);

  // ── element mutation helpers ──────────────────────────────────────────────
  const mutate = (id: string, patch: Partial<DesignEl>) =>
    setDoc((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const updateSel = (patch: Partial<DesignEl>) => { if (sel) mutate(sel.id, patch); };
  const addEl = (kind: ElKind, field?: DesignEl["field"]) => {
    const el = newElement(kind, doc.w, doc.h);
    if (field) { el.field = field; if (kind === "text") el.text = ""; }
    setDoc((d) => ({ ...d, elements: [...d.elements, el] })); setSelId(el.id);
  };
  const removeSel = () => { if (!sel) return; setDoc((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== sel.id) })); setSelId(null); };
  const dupeSel = () => { if (!sel) return; const c = { ...sel, id: Math.random().toString(36).slice(2, 9), x: sel.x + 2, y: sel.y + 2 }; setDoc((d) => ({ ...d, elements: [...d.elements, c] })); setSelId(c.id); };
  // free vertical space below an element (down to the next element or the label edge)
  const spaceBelow = (el: DesignEl): number => {
    let limit = doc.h;
    for (const o of doc.elements) {
      if (o.id === el.id) continue;
      if (o.x < el.x + el.w && o.x + o.w > el.x && o.y >= el.y) limit = Math.min(limit, o.y);
    }
    return Math.max(1, limit - el.y - 0.3);
  };
  // Set the font size. With Auto-fit ON the text can only be as tall as the box, so
  // we also GROW the box downward into any free space (never over the next element).
  const applySize = (mm: number) => {
    if (!sel) return;
    if (sel.fit === false) { updateSel({ sizeMM: mm }); return; }
    const oneLine = mm * 1.33 * (sel.lineh ?? 1.15) + 0.4; // mm one line needs
    updateSel({ sizeMM: mm, h: Math.max(sel.h, Math.min(spaceBelow(sel), oneLine)) });
  };
  // scale the selected text up/down through the size list (the A− / A+ buttons)
  const stepSize = (dir: 1 | -1) => {
    if (!sel) return;
    const cur = sel.sizeMM ?? 3;
    let i = 0, best = Infinity;
    SIZE_CHOICES_MM.forEach((s, idx) => { const d = Math.abs(s - cur); if (d < best) { best = d; i = idx; } });
    applySize(SIZE_CHOICES_MM[clamp(i + dir, 0, SIZE_CHOICES_MM.length - 1)]);
  };

  // ── drag / resize (pointer) ───────────────────────────────────────────────
  const onDown = (e: React.PointerEvent, el: DesignEl, mode: "move" | "resize") => {
    e.stopPropagation(); setSelId(el.id);
    dragRef.current = { id: el.id, mode, px: e.clientX, py: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const onMove = (e: PointerEvent) => {
    const dr = dragRef.current; if (!dr) return;
    const D = docRef.current;
    const el = D.elements.find((x) => x.id === dr.id); if (!el) return;
    const dx = (e.clientX - dr.px) / scale, dy = (e.clientY - dr.py) / scale;
    if (dr.mode === "move") {
      // keep the element fully INSIDE the label
      const nx = clamp(snap(dr.ox + dx), 0, Math.max(0, D.w - el.w));
      const ny = clamp(snap(dr.oy + dy), 0, Math.max(0, D.h - el.h));
      if (!isContent(el.kind)) { mutate(dr.id, { x: nx, y: ny }); return; }
      // block overlap: try the full move, else slide along one free axis, else stay
      if (!collides(dr.id, nx, ny, el.w, el.h)) mutate(dr.id, { x: nx, y: ny });
      else if (!collides(dr.id, nx, el.y, el.w, el.h)) mutate(dr.id, { x: nx });
      else if (!collides(dr.id, el.x, ny, el.w, el.h)) mutate(dr.id, { y: ny });
      // else: neighbouring field in the way — hold position
    } else {
      const w = clamp(snap(dr.ow + dx), 3, D.w - el.x);
      const h = clamp(snap(dr.oh + dy), el.kind === "line" ? 0 : 2, D.h - el.y);
      if (!isContent(el.kind) || !collides(dr.id, el.x, el.y, w, h)) mutate(dr.id, { w, h });
    }
  };
  const onUp = () => { dragRef.current = null; window.removeEventListener("pointermove", onMove); };

  // Nudge an element by dx/dy mm (arrow keys), with the same clamp + no-overlap rules.
  const nudgeById = (id: string, dxmm: number, dymm: number) => {
    const D = docRef.current;
    const el = D.elements.find((x) => x.id === id); if (!el) return;
    const nx = clamp(snap(el.x + dxmm), 0, Math.max(0, D.w - el.w));
    const ny = clamp(snap(el.y + dymm), 0, Math.max(0, D.h - el.h));
    if (!isContent(el.kind)) { mutate(id, { x: nx, y: ny }); return; }
    if (!collides(id, nx, ny, el.w, el.h)) mutate(id, { x: nx, y: ny });
    else if (dxmm !== 0 && !collides(id, nx, el.y, el.w, el.h)) mutate(id, { x: nx });
    else if (dymm !== 0 && !collides(id, el.x, ny, el.w, el.h)) mutate(id, { y: ny });
  };
  // Arrow keys move the selected element (Shift = bigger step); ignored while typing.
  useEffect(() => {
    if (!selId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const step = e.shiftKey ? 2 : 0.5;
      let dx = 0, dy = 0;
      if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step;
      else if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step;
      else return;
      e.preventDefault();
      nudgeById(selId, dx, dy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  // ── actions ───────────────────────────────────────────────────────────────
  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/erp/labels/design", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sizeId, ...extra }),
      });
      const d = await r.json();
      if (!d.ok) { setMsg({ ok: false, text: d.error || "Failed." }); return false; }
      return true;
    } catch (err) { setMsg({ ok: false, text: String(err) }); return false; }
    finally { setBusy(false); }
  };
  const saveDraft = async () => { if (await post("save", { doc })) { setMsg({ ok: true, text: "Draft saved. It does NOT print yet — approve it to go live." }); setStatus((s) => (s === "approved" ? "approved" : "draft")); } };
  const approve = async () => {
    if (problems.size > 0) { setMsg({ ok: false, text: `Fix the ${problems.size} field(s) highlighted RED (overlapping another field, or outside the label) before approving.` }); return; }
    if (!confirm("Approve & DEPLOY this design? From now on this size prints the new design (the old one is archived). Only do this once you've test-printed and it looks right.")) return;
    if (await post("save", { doc })) if (await post("approve")) { setMsg({ ok: true, text: "✓ Approved — this design is now LIVE for printing." }); setStatus("approved"); }
  };
  const revert = async () => { if (!confirm("Discard this draft and go back to the currently-approved design?")) return; if (await post("revert")) load(sizeId); };

  // ── load a real SKU so the preview/test uses the real QR + data ───────────
  const loadSku = async () => {
    const code = testCode.trim(); if (!code) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/erp/labels/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: [code] }) });
      const d = await r.json();
      const l = (d.labels || [])[0];
      if (!l) { setMsg({ ok: false, text: `SKU ${code} not found.` }); return; }
      setFill({ sku_code: l.sku_code, name: l.name, header: l.header, price: l.price, unit: l.unit || "PCS", singleQty: l.singleQty ?? 1, masterQty: l.masterQty ?? 1, lot: l.lot, rack: l.rack, pkd: l.pkd, qrSvg: l.qrSvgSingle || l.qrSvg, qrMatrix: l.qrMatrixSingle, address: fill.address });
      setMsg({ ok: true, text: `Loaded ${l.sku_code} — preview now shows its real QR & data.` });
    } catch { setMsg({ ok: false, text: "Could not load that SKU." }); }
  };

  const testPrint = async () => {
    if (!brPrinterId) { setMsg({ ok: false, text: "Pick a printer for the test print." }); return; }
    setBusy(true); setMsg(null);
    try {
      const name = brPrinters.find((p) => p.id === brPrinterId)?.name || "";
      const dpi = /\b34[5-9]\b|300\s*?dpi/i.test(name) ? 300 : 203;
      const dp = dpi === 203 ? 8 : dpi / 25.4;
      await ensureFontsLoaded(doc);
      const bmp = await renderDocToTSPL(doc, effFill, dp);
      const r = await fetch("/api/erp/labels/print-raster", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ printerId: brPrinterId, sizeId, w: doc.w, h: doc.h, copies: Math.max(1, copies), skuCode: fill.sku_code, ...bmp }),
      });
      const d = await r.json();
      setMsg(d.ok ? { ok: true, text: `🖨 Sent ${d.queued} test label(s) to the printer.` } : { ok: false, text: d.error || "Print failed." });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  const W = Math.round(doc.w * scale), H = Math.round(doc.h * scale);
  return (
    <div className="flex flex-col gap-3">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
        <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm font-bold">
          {sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${locked ? "bg-[var(--danger)] text-white" : status === "approved" ? "bg-[var(--accent-2)] text-white" : "bg-[var(--surface-2)]"}`}>
          {locked ? "🔒 LOCKED — old design keeps printing" : status === "approved" ? "● Approved (live)" : status === "draft" ? "◔ Draft (not printing)" : "New"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setScale((s) => Math.max(4, s - 1))} className="rounded border border-[var(--border)] px-2 py-1 text-sm font-bold">−</button>
          <span className="w-16 text-center text-xs font-bold">{scale} px/mm</span>
          <button onClick={() => setScale((s) => Math.min(16, s + 1))} className="rounded border border-[var(--border)] px-2 py-1 text-sm font-bold">+</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* add-element rail */}
        <div className="flex w-40 flex-col gap-1.5">
          <p className="text-xs font-bold text-[var(--muted)]">ADD TO LABEL</p>
          <button onClick={() => addEl("text", "code")} className="ADDBTN">＋ SKU code</button>
          <button onClick={() => addEl("text", "header")} className="ADDBTN">＋ Header (part type)</button>
          <button onClick={() => addEl("text", "name")} className="ADDBTN">＋ Name (variant)</button>
          <button onClick={() => addEl("text", "mrp")} className="ADDBTN">＋ MRP</button>
          <button onClick={() => addEl("text", "qty")} className="ADDBTN">＋ Qty</button>
          <button onClick={() => addEl("text", "lot")} className="ADDBTN">＋ Lot no</button>
          <button onClick={() => addEl("text", "rack")} className="ADDBTN">＋ Rack no</button>
          <button onClick={() => addEl("text", "pkd")} className="ADDBTN">＋ PKD date</button>
          <button onClick={() => addEl("text", "address")} className="ADDBTN">＋ Address block</button>
          <button onClick={() => addEl("text", "custom")} className="ADDBTN">＋ Free text</button>
          <button onClick={() => addEl("qr")} className="ADDBTN">＋ QR code</button>
          <button onClick={() => addEl("barcode", "code")} className="ADDBTN">＋ Barcode</button>
          <button onClick={() => addEl("line")} className="ADDBTN">＋ Line</button>
          <button onClick={() => addEl("box")} className="ADDBTN">＋ Box</button>
          <style>{`.ADDBTN{border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12px;font-weight:700;text-align:left;background:var(--surface)}.ADDBTN:hover{background:var(--surface-2)}`}</style>
        </div>

        {/* canvas */}
        <div className="flex-1">
          <div className="inline-block rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3" onPointerDown={() => setSelId(null)}>
            <div className="relative" style={{ width: W, height: H }}>
              <canvas ref={canvasRef} className="absolute left-0 top-0 shadow" style={{ width: W, height: H }} />
              {/* selection / drag overlays */}
              {doc.elements.map((el) => (
                <div key={el.id} onPointerDown={(e) => onDown(e, el, "move")}
                  className={`absolute cursor-move ${
                    problems.has(el.id) ? "outline outline-2 outline-[var(--danger)]"
                    : selId === el.id ? "outline outline-2 outline-[var(--accent)]"
                    : isContent(el.kind) ? "outline outline-1 outline-dashed outline-[var(--border)] hover:outline-[var(--accent)]"
                    : "hover:outline hover:outline-1 hover:outline-[var(--accent)]"}`}
                  style={{ left: el.x * scale, top: el.y * scale, width: Math.max(6, el.w * scale), height: Math.max(6, (el.h || 1) * scale) }}>
                  {selId === el.id && (
                    <span onPointerDown={(e) => onDown(e, el, "resize")}
                      className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-[var(--accent)]" />
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Actual size {doc.w}×{doc.h} mm · drag boxes to place · drag the corner to resize · arrow keys nudge (Shift = bigger step) · this is exactly what prints.</p>
          {problems.size > 0 && <p className="mt-1 text-xs font-bold text-[var(--danger)]">⚠ {problems.size} field(s) overlap or spill outside the label (outlined red) — fix before approving.</p>}
        </div>

        {/* properties */}
        <div className="w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          {!sel ? <p className="text-sm text-[var(--muted)]">Select an element to edit it, or add one from the left.</p> : (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold capitalize">{sel.kind}{sel.field && sel.field !== "custom" ? ` · ${sel.field}` : ""}</span>
                <div className="flex gap-1">
                  <button onClick={dupeSel} title="Duplicate" className="rounded border border-[var(--border)] px-1.5 text-xs">⧉ Copy</button>
                  <button onClick={removeSel} title="Delete" className="rounded border border-[var(--danger)] px-1.5 text-xs text-[var(--danger)]">🗑 Delete</button>
                </div>
              </div>

              {(sel.field === "custom" || sel.field === "address") && (
                <textarea value={sel.text ?? ""} onChange={(e) => updateSel({ text: e.target.value })} rows={sel.field === "address" ? 3 : 2}
                  placeholder={sel.field === "address" ? "Your company address…" : "Text…"} className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm" />
              )}

              {(sel.kind === "text" || sel.kind === "barcode") && sel.kind === "text" && (
                <>
                  <label className="text-xs font-bold text-[var(--muted)]">Font</label>
                  <select value={sel.font || "Arial"} onChange={(e) => updateSel({ font: e.target.value })} className="rounded-lg border border-[var(--border)] px-2 py-1">
                    {FONT_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <label className="text-xs font-bold text-[var(--muted)]">Text size</label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => stepSize(-1)} title="Smaller" className="rounded border border-[var(--border)] px-2 py-1 text-sm font-bold">A−</button>
                    <select value={SIZE_CHOICES_MM.includes(sel.sizeMM ?? 3) ? (sel.sizeMM ?? 3) : ""} onChange={(e) => applySize(Number(e.target.value))} className="flex-1 rounded-lg border border-[var(--border)] px-2 py-1">
                      {!SIZE_CHOICES_MM.includes(sel.sizeMM ?? 3) && <option value="">{(sel.sizeMM ?? 3).toFixed(1)} mm</option>}
                      {SIZE_CHOICES_MM.map((s) => <option key={s} value={s}>{s} mm</option>)}
                    </select>
                    <button onClick={() => stepSize(1)} title="Bigger" className="rounded border border-[var(--border)] px-2 py-1 text-base font-bold">A+</button>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => updateSel({ bold: !sel.bold })} className={`flex-1 rounded border px-2 py-1 font-bold ${sel.bold ? "bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}>B</button>
                    <button onClick={() => updateSel({ italic: !sel.italic })} className={`flex-1 rounded border px-2 py-1 italic ${sel.italic ? "bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}>I</button>
                    {(["left", "center", "right"] as const).map((a) => (
                      <button key={a} onClick={() => updateSel({ align: a })} className={`flex-1 rounded border px-2 py-1 text-xs ${sel.align === a ? "bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}>{a[0].toUpperCase()}</button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-xs font-bold">
                    <input type="checkbox" checked={!!sel.fit} onChange={(e) => updateSel({ fit: e.target.checked })} />
                    Auto‑fit — shrink long text to the box
                  </label>
                  {sel.fit && <p className="text-[11px] text-[var(--muted)]">Auto-fit ON: size is the MAX and the box grows into free space. For a bigger fixed size, <b>uncheck Auto-fit</b> — or drag the box taller / move the box below it down.</p>}
                </>
              )}

              {(sel.kind === "box" || sel.kind === "line") && (
                <label className="text-xs font-bold text-[var(--muted)]">Thickness (mm)
                  <input type="number" step={0.1} min={0.1} value={sel.strokeMM ?? 0.3} onChange={(e) => updateSel({ strokeMM: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1" />
                </label>
              )}

              <div className="grid grid-cols-4 gap-1 text-xs">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <label key={k} className="font-bold text-[var(--muted)]">{k.toUpperCase()}
                    <input type="number" step={0.5} value={(sel as unknown as Record<string, number>)[k]} onChange={(e) => setGeom(k, Number(e.target.value))} className="mt-0.5 w-full rounded border border-[var(--border)] px-1 py-0.5" />
                  </label>
                ))}
              </div>
              <label className="text-xs font-bold text-[var(--muted)]">Rotation
                <select value={sel.rot ?? 0} onChange={(e) => updateSel({ rot: Number(e.target.value) as DesignEl["rot"] })} className="mt-0.5 w-full rounded border border-[var(--border)] px-1 py-0.5">
                  {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* action bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
        <input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="SKU code for real QR / test" className="w-48 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm" />
        <button onClick={loadSku} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold">Load SKU</button>
        <label className="flex items-center gap-1.5 text-xs font-bold" title="Preview a very long product name to check auto-fit shrinking">
          <input type="checkbox" checked={testLong} onChange={(e) => setTestLong(e.target.checked)} /> Long‑name test
        </label>
        <select value={brPrinterId} onChange={(e) => setBrPrinterId(e.target.value)} className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm">
          <option value="">Test printer…</option>
          {brPrinters.map((p) => <option key={p.id} value={p.id} disabled={!p.online}>{(p.code || p.name)}{p.online ? "" : " (offline)"}</option>)}
        </select>
        <input type="number" min={1} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} className="w-16 rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm" />
        <button onClick={testPrint} disabled={busy} className="rounded-lg border-2 border-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent-strong)] disabled:opacity-50">🖨 Test print</button>
        <div className="ml-auto flex gap-2">
          <button onClick={revert} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold disabled:opacity-50">Revert draft</button>
          <button onClick={saveDraft} disabled={busy} className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm font-bold disabled:opacity-50">Save draft</button>
          <button onClick={approve} disabled={busy || locked} title={locked ? "Unlock this size first" : ""} className="rounded-lg bg-[var(--accent-2)] px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">✓ Approve &amp; deploy</button>
        </div>
      </div>
      {msg && <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${msg.ok ? "bg-[var(--accent-bg)] text-[var(--accent-strong)]" : "bg-[var(--danger)]/10 text-[var(--danger)]"}`}>{msg.text}</div>}
    </div>
  );
}
