"use client";

import { useRef, useState } from "react";

export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number; b?: number; mm?: number; r?: number };
export type Layout = { offsetX: number; offsetY: number; qrMM: number; elements?: Record<string, ElOverride>; design?: number; locked?: boolean; lockCode?: string | null };

// A QR-like placeholder (finder patterns) so the preview shows the QR's box/position.
// `bg` = the label colour under the QR (white panel on red stock, green on green
// stock) so the quiet zone matches the print (the QR prints black on that colour).
function QrGlyph({ bg = "#fff" }: { bg?: string }) {
  return (
    <svg viewBox="0 0 21 21" className="h-full w-full" shapeRendering="crispEdges">
      <rect width="21" height="21" fill={bg} />
      {[[0, 0], [14, 0], [0, 14]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="7" height="7" fill="#000" />
          <rect x={x + 1} y={y + 1} width="5" height="5" fill={bg} />
          <rect x={x + 2} y={y + 2} width="3" height="3" fill="#000" />
        </g>
      ))}
      {[[9, 2], [11, 4], [9, 6], [13, 9], [10, 10], [16, 11], [9, 13], [12, 14], [15, 15], [10, 17], [13, 18], [17, 9], [8, 9], [9, 9], [11, 11]].map(([x, y], i) => (
        <rect key={`d${i}`} x={x} y={y} width="1.4" height="1.4" fill="#000" />
      ))}
    </svg>
  );
}

type ElKey = "all" | "qr" | "code" | "name" | "qty" | "mrp" | "incl" | "lot" | "pkd" | "rack";
const TABS: { key: ElKey; label: string }[] = [
  { key: "all", label: "Whole label" },
  { key: "qr", label: "QR code" },
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "qty", label: "Qty" },
  { key: "mrp", label: "MRP" },
  { key: "incl", label: "Taxes line" },
  { key: "lot", label: "Lot No" },
  { key: "pkd", label: "PKD date" },
  { key: "rack", label: "Rack No" },
];
// Approx TSPL bitmap-font heights (mm) so the preview font tracks the size control.
const FONT_MM: Record<number, number> = { 1: 1.7, 2: 2.1, 3: 2.6, 4: 3.2, 5: 3.9, 6: 7.6, 7: 11.4 };

export default function LabelAligner({
  sizeId, w, h, pos, sample, initial, onClose, onSaved, onLockChange,
}: {
  sizeId: string; w: number; h: number; pos: "top" | "bottom";
  sample: { code: string; name: string; qty: string; mrp: string };
  initial: Layout; onClose: () => void; onSaved: (l: Layout) => void;
  onLockChange?: (locked: boolean, lockCode: string | null) => void;
}) {
  const [ox, setOx] = useState(initial.offsetX || 0);
  const [oy, setOy] = useState(initial.offsetY || 0);
  const [els, setEls] = useState<Record<string, ElOverride>>(initial.elements ? JSON.parse(JSON.stringify(initial.elements)) : {});
  const [sel, setSel] = useState<ElKey>("qr");
  const [saving, setSaving] = useState(false);
  // Lock state: once locked the layout is FROZEN on the server (no save can change it).
  const [locked, setLocked] = useState(!!initial.locked);
  const [lockCode, setLockCode] = useState<string | null>(initial.lockCode ?? null);
  const [locking, setLocking] = useState(false);
  async function doLock() {
    if (!confirm(`Lock the ${w}×${h} mm label?\n\nThis freezes its design + alignment and gives it a unique code. After locking, NOTHING (resets, other PCs, re-aligns) can change it until you unlock. Make sure your test print looked right first.`)) return;
    setLocking(true);
    try {
      // SAVE-THEN-LOCK: persist exactly what's on screen FIRST, so the frozen snapshot is
      // precisely what the operator sees — never a stale earlier save. (The lock endpoint
      // snapshots the DB row, so the DB must hold the current alignment before we lock.)
      const sv = await fetch("/api/erp/labels/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sizeId, offsetX: ox, offsetY: oy, qrMM: 0, elements: els }) });
      const svd = await sv.json().catch(() => ({}));
      if (!sv.ok || !svd.ok) { alert("Could not save the current alignment before locking — nothing was locked. " + (svd.error || `server ${sv.status}`)); return; }
      const r = await fetch("/api/erp/labels/lock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lock", sizeId, w, h }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { alert("Could not lock: " + (d.error || `server ${r.status}`)); return; }
      setLocked(true); setLockCode(d.lockCode); onLockChange?.(true, d.lockCode);
      alert(`🔒 Locked as ${d.lockCode}.\n\nThis exact layout is saved on the backend under ${d.lockCode}. If it ever gets disturbed, restore it by this code.`);
    } catch { alert("Could not lock — network error."); }
    finally { setLocking(false); }
  }
  async function doUnlock() {
    if (!confirm(`Unlock the ${w}×${h} mm label so it can be edited again?\n\nThe saved snapshot ${lockCode || ""} is kept — you can always re-lock or restore it.`)) return;
    setLocking(true);
    try {
      const r = await fetch("/api/erp/labels/lock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unlock", sizeId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { alert("Could not unlock: " + (d.error || `server ${r.status}`)); return; }
      setLocked(false); onLockChange?.(false, lockCode);
    } catch { alert("Could not unlock — network error."); }
    finally { setLocking(false); }
  }
  // free-text draft for the "exact mm" box so typing isn't snapped back mid-keystroke
  const [mmDraft, setMmDraft] = useState<{ k: string; v: string } | null>(null);

  const SCALE = Math.max(4, Math.min(11, Math.floor(560 / w))); // px per mm
  const px = (mm: number) => mm * SCALE;
  const now = new Date();
  const todayStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getFullYear()).slice(2)}`;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const setEl = (k: string, patch: ElOverride) =>
    setEls((m) => ({ ...m, [k]: { ...m[k], ...patch } }));

  // ── Drag-to-move (trackpad/mouse): drag any element in the preview to reposition ──
  const dragRef = useRef<{ k: string; sx: number; sy: number; dx0: number; dy0: number } | null>(null);
  const onDragStart = (k: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't let a child drag bubble to the "all" background handler
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSel(k as ElKey);
    dragRef.current = k === "all"
      ? { k, sx: e.clientX, sy: e.clientY, dx0: ox, dy0: oy }
      : { k, sx: e.clientX, sy: e.clientY, dx0: els[k]?.dx || 0, dy0: els[k]?.dy || 0 };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = r1(d.dx0 + (e.clientX - d.sx) / SCALE);
    const dy = r1(d.dy0 + (e.clientY - d.sy) / SCALE);
    if (d.k === "all") { setOx(dx); setOy(dy); } else setEl(d.k, { dx, dy });
  };
  const onDragEnd = () => { dragRef.current = null; };
  // pointer props applied to each draggable preview element
  const drag = (k: string) => ({ onPointerDown: onDragStart(k), onPointerMove: onDragMove, onPointerUp: onDragEnd });
  const dragStyle = { touchAction: "none" as const, cursor: "move" as const };
  // Bold: per text element, or all text at once from the "Whole label" tab.
  const TEXT_KEYS = ["code", "name", "qty", "mrp", "incl", "lot", "pkd", "rack"];
  const isBold = sel === "all" ? TEXT_KEYS.every((k) => els[k]?.b) : !!els[sel]?.b;
  const toggleBold = () => {
    const on = !isBold;
    if (sel === "all") setEls((m) => { const c = { ...m }; for (const k of TEXT_KEYS) c[k] = { ...c[k], b: on ? 1 : 0 }; return c; });
    else if (sel !== "qr") setEl(sel, { b: on ? 1 : 0 });
  };

  // Nudge / size act on whichever attribute is selected.
  const nudge = (axis: "dx" | "dy", d: number) => {
    if (sel === "all") { if (axis === "dx") setOx((v) => r1(v + d)); else setOy((v) => r1(v + d)); return; }
    setEl(sel, { [axis]: r1((els[sel]?.[axis] || 0) + d) });
  };

  // ── Auto layout mirrors buildTSPL so the preview matches the print ──────────
  // The green sizes (95×70, 70×40, 65×35, 50×30) use the "hero" fill: big bold name
  // on the LEFT, QR bottom-RIGHT. The red keeps QR-left. Custom = compact QR-left.
  const bigGreen = w === 95 && h === 70;
  const heroSmall = pos === "top" && ((w === 70 && h === 40) || (w === 65 && h === 35) || (w === 50 && h === 30));
  const hero = bigGreen || heroSmall;
  const zoneTop = h * (pos === "bottom" ? 0.36 : heroSmall ? 0.05 : bigGreen ? 0.07 : 0.08);
  const zoneBot = h * (pos === "bottom" ? 0.92 : heroSmall ? 0.72 : bigGreen ? 0.63 : 0.62);
  const zoneH = zoneBot - zoneTop;
  const big = h >= 54, med = h >= 38;
  const nameDef = big ? 5 : med ? 4 : 3;
  const codeDef = hero ? (heroSmall ? Math.max(2, nameDef - 1) : nameDef) : nameDef;
  const exDef = big ? 3 : 2;
  const defFont: Record<string, number> = { code: codeDef, name: nameDef, qty: big ? 4 : med ? 3 : 2, mrp: big ? 4 : med ? 3 : 2, extras: exDef, incl: exDef, lot: exDef, pkd: exDef, rack: exDef };
  // Rotation transform for the preview (matches TSPL 0/90/180/270 clockwise).
  const rotStyle = (k: string) => (els[k]?.r ? { transform: `rotate(${els[k]!.r}deg)`, transformOrigin: "left top" as const } : {});
  const fontOf = (k: string) => (els[k]?.f && els[k]!.f! >= 1 ? els[k]!.f! : defFont[k]);
  // Effective text height (mm): an exact mm override wins, else the size level's mm.
  const mmOf = (k: string) => (els[k]?.mm && els[k]!.mm! > 0 ? els[k]!.mm! : FONT_MM[fontOf(k)]);
  const lhmm = (k: string) => mmOf(k) + 0.8;

  const autoQr = hero ? Math.min(heroSmall ? Math.min(20, h * 0.5) : 32, zoneH) : Math.max(8, Math.min(zoneH - 3, w * 0.5, 28));
  const qrSize = els.qr?.sz && els.qr.sz > 0 ? els.qr.sz : autoQr;
  const qrXa = (hero ? w - qrSize - 4 : 5) + ox;
  const qrYa = (hero ? zoneBot - qrSize : zoneTop + Math.max(0, (zoneH - qrSize) / 2)) + oy;
  const textXa = (hero ? (heroSmall ? 4 : 1.5) : qrXa + qrSize + 2 - ox) + ox;

  // Stacked auto y-positions for the text block (starts at the top on hero labels).
  let ty = hero ? zoneTop + 1 : qrYa;
  const codeYa = ty; ty += lhmm("code");
  const nameYa = ty; ty += lhmm("name") * 1.7; // name ~ up to 2 lines
  const qtyYa = ty; ty += lhmm("qty");
  const mrpYa = ty;

  const box = (k: string, xa: number, ya: number) => ({ left: xa + (els[k]?.dx || 0), top: ya + (els[k]?.dy || 0) });
  const qrBox = { left: qrXa + (els.qr?.dx || 0), top: qrYa + (els.qr?.dy || 0), size: qrSize };
  const codeB = box("code", textXa, codeYa), nameB = box("name", textXa, nameYa), qtyB = box("qty", textXa, qtyYa), mrpB = box("mrp", textXa, mrpYa);
  // Attribute band split into independent lines (Incl / Lot / PKD / Rack).
  const exTop = mrpYa + lhmm("mrp");
  const inclB = box("incl", textXa, exTop);
  const lotB = box("lot", textXa, exTop + lhmm("incl"));
  const pkdB = box("pkd", textXa, exTop + lhmm("incl") + lhmm("lot"));
  const rackB = box("rack", textXa, exTop + lhmm("incl") + lhmm("lot") + lhmm("pkd"));

  const selStyle = (k: ElKey) => sel === k ? { outline: "2px solid #e11d2a", outlineOffset: 2, borderRadius: 3 } : {};

  async function save() {
    if (locked) { alert(`This label is locked (${lockCode || ""}). Unlock it first to make changes.`); return; }
    setSaving(true);
    try {
      const body = { sizeId, offsetX: ox, offsetY: oy, qrMM: 0, elements: els };
      const r = await fetch("/api/erp/labels/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      // Only treat it as saved if the server actually persisted it — otherwise the
      // setting would appear to work this session but vanish on reload (per-SKU redo).
      if (!r.ok || !d.ok) { alert("Could not save this alignment — it was NOT stored. " + (d.error || `Server error ${r.status}.`) + "\nYou may not have permission to edit labels."); return; }
      onSaved({ offsetX: ox, offsetY: oy, qrMM: 0, elements: els });
    } catch { alert("Could not save this alignment — network error. It was NOT stored."); }
    finally { setSaving(false); }
  }

  const NudgeBtn = ({ label, on }: { label: string; on: () => void }) => (
    <button onClick={on} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-lg font-bold hover:bg-[var(--surface-2)] active:bg-[var(--accent-bg)]">{label}</button>
  );

  // Highlight the size button nearest the element's current mm (buttons set exact mm).
  const curFont = sel !== "all" && sel !== "qr"
    ? ([1, 2, 3, 4, 5, 6, 7] as number[]).reduce((b, k) => Math.abs(FONT_MM[k] - mmOf(sel)) < Math.abs(FONT_MM[b] - mmOf(sel)) ? k : b, 1)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-6">
          <h2 className="text-lg font-extrabold">🎯 Design label · {w} × {h} mm</h2>
          <div className="flex items-center gap-2">
            {locked && lockCode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-2-bg)] px-3 py-1 text-xs font-extrabold text-[var(--accent-2)]">🔒 Locked · {lockCode}</span>
            )}
            <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">✕ Close</button>
          </div>
        </div>
        {locked && (
          <div className="mb-3 rounded-lg border border-[var(--accent-2)] bg-[var(--accent-2-bg)] px-3 py-2 text-xs font-semibold text-[var(--accent-2)]">
            This label is <b>frozen</b> under <b>{lockCode}</b> — resets, other PCs and re-aligns cannot change it. Unlock below to edit.
          </div>
        )}

        {/* attribute tabs */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setSel(t.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${sel === t.key ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-6">
          {/* live preview */}
          <div>
            <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Print preview (actual size) — drag any attribute to move it</div>
            <div className="relative overflow-hidden rounded-[5px] border-2 border-[var(--border)] shadow-inner" {...drag("all")} style={{ ...dragStyle, width: px(w), height: px(h), background: pos === "bottom" ? "#c62128" : "#8cc63f" }}>
              {/* pre-printed artwork — drawn to match the physical stock so the team
                  aligns against the real red frame + banner (or the green footer). */}
              {pos === "bottom" ? (
                <>
                  {/* red top banner (company name + address) */}
                  <div className="absolute inset-x-0 top-0 flex flex-col items-center justify-center text-center leading-tight text-white" style={{ height: px(h * 0.26) }}>
                    <span className="font-extrabold" style={{ fontSize: Math.max(6, px(2.4)), letterSpacing: "0.04em" }}>SILVER UP</span>
                    <span className="font-bold" style={{ fontSize: Math.max(4, px(1.55)) }}>SILVER INDUSTRIES, 50, Oswal Agro Ind. Complex</span>
                    <span style={{ fontSize: Math.max(3, px(1.05)) }}>G.T. Road, Ludhiana-141010 PB · info@silverup.com</span>
                  </div>
                  {/* white content panel — the red shows as a border all around it */}
                  <div className="absolute rounded-[7px] bg-white" style={{ left: px(w * 0.045), right: px(w * 0.045), top: px(h * 0.28), bottom: px(h * 0.05) }} />
                </>
              ) : (
                // Green stock: whole label is green, address pre-printed as a black footer.
                <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end text-center font-extrabold leading-tight text-black" style={{ height: px(h * 0.36), paddingBottom: px(h * 0.04) }}>
                  <span style={{ fontSize: Math.max(5, px(1.9)) }}>SILVER IND. 50, OSWAL IND. COMPLEX</span>
                  <span style={{ fontSize: Math.max(5, px(1.9)) }}>G.T.ROAD, LUDHIANA-141010</span>
                  <span className="font-semibold" style={{ fontSize: Math.max(3, px(1.05)) }}>CUS. CARE : Mail: silverup.ldh@gmail.com PH. NO. 0161-5196409</span>
                </div>
              )}
              {/* QR */}
              <div className="absolute cursor-pointer" {...drag("qr")} style={{ ...dragStyle, left: px(qrBox.left), top: px(qrBox.top), width: px(qrBox.size), height: px(qrBox.size), ...rotStyle("qr"), ...selStyle("qr") }}><QrGlyph bg={pos === "bottom" ? "#fff" : "#8cc63f"} /></div>
              {/* text attributes — each independently placed & rotatable */}
              <div className="absolute cursor-pointer font-mono font-extrabold leading-none text-black" {...drag("code")} style={{ ...dragStyle, left: px(codeB.left), top: px(codeB.top), fontSize: px(mmOf("code")), fontWeight: els.code?.b ? 900 : undefined, ...rotStyle("code"), ...selStyle("code") }}>{sample.code}</div>
              <div className="absolute cursor-pointer font-mono font-bold leading-tight text-black" {...drag("name")} style={{ ...dragStyle, left: px(nameB.left), top: px(nameB.top), fontSize: px(mmOf("name")), maxWidth: px((hero ? qrXa - 2 : w) - nameB.left - 1), fontWeight: hero || els.name?.b ? 900 : undefined, ...rotStyle("name"), ...selStyle("name") }}>{sample.name}</div>
              <div className="absolute cursor-pointer font-mono leading-none text-black" {...drag("qty")} style={{ ...dragStyle, left: px(qtyB.left), top: px(qtyB.top), fontSize: px(mmOf("qty")), fontWeight: els.qty?.b ? 900 : undefined, ...rotStyle("qty"), ...selStyle("qty") }}>{sample.qty}</div>
              <div className="absolute cursor-pointer font-mono leading-none text-black" {...drag("mrp")} style={{ ...dragStyle, left: px(mrpB.left), top: px(mrpB.top), fontSize: px(mmOf("mrp")), fontWeight: els.mrp?.b ? 900 : undefined, ...rotStyle("mrp"), ...selStyle("mrp") }}>{sample.mrp}</div>
              {/* attribute band — each line independent (move / size / rotate) */}
              {([
                { k: "incl", b: inclB, t: "(Incl. of All Taxes)" },
                { k: "lot", b: lotB, t: "Lot No:" },
                { k: "pkd", b: pkdB, t: `PKD: ${todayStr}` },
                { k: "rack", b: rackB, t: "Rack No:" },
              ] as const).map(({ k, b, t }) => (
                <div key={k} className="absolute cursor-pointer whitespace-nowrap font-mono leading-none text-black" {...drag(k)}
                  style={{ ...dragStyle, left: px(b.left), top: px(b.top), fontSize: px(mmOf(k)), fontWeight: els[k]?.b ? 900 : undefined, ...rotStyle(k), ...selStyle(k) }}>{t}</div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[var(--muted-2)]">Position &amp; QR size match the print; on-screen font is only an approximation.</p>
          </div>

          {/* controls for the SELECTED attribute */}
          <div className="flex w-56 flex-col gap-4">
            <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm font-bold">
              Editing: <span className="text-[var(--accent-strong)]">{TABS.find((t) => t.key === sel)?.label}</span>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase text-[var(--muted)]">Move (0.5 mm steps)</div>
              <div className="flex flex-col items-center gap-1">
                <NudgeBtn label="▲" on={() => nudge("dy", -0.5)} />
                <div className="flex gap-8">
                  <NudgeBtn label="◀" on={() => nudge("dx", -0.5)} />
                  <NudgeBtn label="▶" on={() => nudge("dx", 0.5)} />
                </div>
                <NudgeBtn label="▼" on={() => nudge("dy", 0.5)} />
              </div>
              <div className="mt-2 text-center text-xs font-semibold text-[var(--muted)]">
                {sel === "all"
                  ? <>X {ox > 0 ? "+" : ""}{ox.toFixed(1)} · Y {oy > 0 ? "+" : ""}{oy.toFixed(1)} mm</>
                  : <>X {(els[sel]?.dx || 0) > 0 ? "+" : ""}{(els[sel]?.dx || 0).toFixed(1)} · Y {(els[sel]?.dy || 0) > 0 ? "+" : ""}{(els[sel]?.dy || 0).toFixed(1)} mm</>}
              </div>
            </div>

            {/* size control depends on the selection */}
            {sel === "qr" && (
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
                QR size — {qrSize.toFixed(0)} mm{els.qr?.sz ? "" : " (auto)"}
                <input type="range" min={8} max={Math.min(40, Math.floor(w * 0.6))} step={1}
                  value={qrSize} onChange={(e) => setEl("qr", { sz: Number(e.target.value) })} className="accent-[var(--accent)]" />
              </label>
            )}
            {sel !== "qr" && sel !== "all" && (
              <div className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
                Text size {els[sel]?.f || els[sel]?.mm ? "" : "(auto)"}
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6].map((f) => (
                    <button key={f} onClick={() => setEl(sel, { f, mm: FONT_MM[f] })}
                      className={`flex-1 rounded-md border py-1.5 text-xs font-bold ${curFont === f ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"}`}>
                      {["", "XS", "S", "M", "L", "XL", "XXL"][f]}
                    </button>
                  ))}
                </div>
                {/* exact size in mm — the printer picks the closest achievable height */}
                <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold normal-case text-[var(--muted)]">
                  or exact mm
                  <input type="number" min={1} max={14} step={0.1}
                    value={mmDraft && mmDraft.k === sel ? mmDraft.v : String(mmOf(sel))}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMmDraft({ k: sel, v });
                      const mm = Number(v);
                      if (!Number.isFinite(mm) || mm <= 0) return;
                      setEl(sel, { mm: Math.round(mm * 10) / 10 });
                    }}
                    className="w-16 rounded-md border border-[var(--border)] px-2 py-1 text-center text-xs font-bold text-[var(--ink)]" />
                  mm
                </label>
              </div>
            )}
            {sel === "all" && (
              <p className="text-xs text-[var(--muted)]">Moves <b>every</b> attribute together. To move just one (QR, Name…), pick it in the tabs above.</p>
            )}

            {sel !== "qr" && (
              <button onClick={toggleBold}
                className={`rounded-lg border px-3 py-2 text-sm font-bold ${isBold ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"}`}>
                {isBold ? "✓ Bold" : "Bold"}{sel === "all" ? " (all text)" : ""}
              </button>
            )}

            {sel !== "all" && sel !== "qr" && (
              <div className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
                Rotate {(els[sel]?.r || 0) ? `· ${els[sel]?.r}°` : ""}
                <div className="flex gap-1">
                  {[0, 90, 180, 270].map((r) => (
                    <button key={r} onClick={() => setEl(sel, { r })}
                      className={`flex-1 rounded-md border py-1.5 text-xs font-bold ${(els[sel]?.r || 0) === r ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"}`}>
                      {r}°
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { if (sel === "all") { setOx(0); setOy(0); } else setEls((m) => { const c = { ...m }; delete c[sel]; return c; }); }} disabled={locked}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)] disabled:opacity-40">Reset this</button>
              <button onClick={save} disabled={saving || locked} className="flex-1 rounded-lg bg-[var(--accent-2)] px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save all"}</button>
            </div>
            {!locked && (
              <button onClick={() => { setOx(0); setOy(0); setEls({}); }} className="text-xs font-semibold text-[var(--muted)] underline hover:text-[var(--accent-strong)]">Reset the whole label to auto</button>
            )}

            {/* Lock: freeze this size after a good test print — mints a unique code and
                makes the layout tsunami-proof (no reset/PC/re-align can change it). */}
            <div className="mt-1 rounded-lg border-2 border-dashed border-[var(--border)] p-2">
              {!locked ? (
                <button onClick={doLock} disabled={locking}
                  className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-extrabold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
                  {locking ? "Locking…" : "🔒 Lock this label"}
                </button>
              ) : (
                <button onClick={doUnlock} disabled={locking}
                  className="w-full rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-extrabold text-[var(--accent-strong)] hover:bg-[var(--accent-bg)] disabled:opacity-60">
                  {locking ? "…" : `🔓 Unlock (${lockCode || "locked"})`}
                </button>
              )}
              <p className="mt-1 text-[10px] text-[var(--muted-2)]">Save &amp; test-print first. Locking freezes design + alignment under a unique code you can always restore by.</p>
            </div>
            <p className="text-[10px] text-[var(--muted-2)]">Saved for this size and shared with every ERP PC — applied automatically on every print.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
