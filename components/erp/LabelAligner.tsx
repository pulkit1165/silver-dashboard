"use client";

import { useState } from "react";

export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number };
export type Layout = { offsetX: number; offsetY: number; qrMM: number; elements?: Record<string, ElOverride> };

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

type ElKey = "all" | "qr" | "code" | "name" | "qty" | "mrp";
const TABS: { key: ElKey; label: string }[] = [
  { key: "all", label: "Whole label" },
  { key: "qr", label: "QR code" },
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "qty", label: "Qty" },
  { key: "mrp", label: "MRP" },
];
// Approx TSPL bitmap-font heights (mm) so the preview font tracks the size control.
const FONT_MM: Record<number, number> = { 1: 1.7, 2: 2.1, 3: 2.6, 4: 3.2, 5: 3.9, 6: 7.6, 7: 11.4 };

export default function LabelAligner({
  sizeId, w, h, pos, sample, initial, onClose, onSaved,
}: {
  sizeId: string; w: number; h: number; pos: "top" | "bottom";
  sample: { code: string; name: string; qty: string; mrp: string };
  initial: Layout; onClose: () => void; onSaved: (l: Layout) => void;
}) {
  const [ox, setOx] = useState(initial.offsetX || 0);
  const [oy, setOy] = useState(initial.offsetY || 0);
  const [els, setEls] = useState<Record<string, ElOverride>>(initial.elements ? JSON.parse(JSON.stringify(initial.elements)) : {});
  const [sel, setSel] = useState<ElKey>("qr");
  const [saving, setSaving] = useState(false);

  const SCALE = Math.max(4, Math.min(11, Math.floor(560 / w))); // px per mm
  const px = (mm: number) => mm * SCALE;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const setEl = (k: string, patch: ElOverride) =>
    setEls((m) => ({ ...m, [k]: { ...m[k], ...patch } }));

  // Nudge / size act on whichever attribute is selected.
  const nudge = (axis: "dx" | "dy", d: number) => {
    if (sel === "all") { if (axis === "dx") setOx((v) => r1(v + d)); else setOy((v) => r1(v + d)); return; }
    setEl(sel, { [axis]: r1((els[sel]?.[axis] || 0) + d) });
  };

  // ── Auto layout mirrors buildTSPL so the preview matches the print ──────────
  const zoneTop = h * (pos === "bottom" ? 0.36 : 0.08);
  const zoneBot = h * (pos === "bottom" ? 0.92 : 0.62);
  const zoneH = zoneBot - zoneTop;
  const big = h >= 54, med = h >= 38;
  const defFont: Record<string, number> = { code: big ? 5 : med ? 4 : 3, name: big ? 5 : med ? 4 : 3, qty: big ? 4 : med ? 3 : 2, mrp: big ? 4 : med ? 3 : 2 };
  const fontOf = (k: string) => (els[k]?.f && els[k]!.f! >= 1 ? els[k]!.f! : defFont[k]);
  const lhmm = (k: string) => FONT_MM[fontOf(k)] + 0.8;

  const autoQr = Math.max(8, Math.min(zoneH - 3, w * 0.5, 28));
  const qrSize = els.qr?.sz && els.qr.sz > 0 ? els.qr.sz : autoQr;
  const qrXa = 5 + ox;
  const qrYa = zoneTop + Math.max(0, (zoneH - qrSize) / 2) + oy;
  const textXa = qrXa + qrSize + 2;

  // Stacked auto y-positions for the text block (base cy advances by auto height).
  let ty = qrYa;
  const codeYa = ty; ty += lhmm("code");
  const nameYa = ty; ty += lhmm("name") * 1.7; // name ~ up to 2 lines
  const qtyYa = ty; ty += lhmm("qty");
  const mrpYa = ty;

  const box = (k: string, xa: number, ya: number) => ({ left: xa + (els[k]?.dx || 0), top: ya + (els[k]?.dy || 0) });
  const qrBox = { left: qrXa + (els.qr?.dx || 0), top: qrYa + (els.qr?.dy || 0), size: qrSize };
  const codeB = box("code", textXa, codeYa), nameB = box("name", textXa, nameYa), qtyB = box("qty", textXa, qtyYa), mrpB = box("mrp", textXa, mrpYa);

  const selStyle = (k: ElKey) => sel === k ? { outline: "2px solid #e11d2a", outlineOffset: 2, borderRadius: 3 } : {};

  async function save() {
    setSaving(true);
    try {
      const body = { sizeId, offsetX: ox, offsetY: oy, qrMM: 0, elements: els };
      await fetch("/api/erp/labels/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      onSaved({ offsetX: ox, offsetY: oy, qrMM: 0, elements: els });
    } finally { setSaving(false); }
  }

  const NudgeBtn = ({ label, on }: { label: string; on: () => void }) => (
    <button onClick={on} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-lg font-bold hover:bg-[var(--surface-2)] active:bg-[var(--accent-bg)]">{label}</button>
  );

  const curFont = sel !== "all" && sel !== "qr" ? fontOf(sel) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-6">
          <h2 className="text-lg font-extrabold">🎯 Design label · {w} × {h} mm</h2>
          <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">✕ Close</button>
        </div>

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
            <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Print preview (actual size) — tap an attribute to select</div>
            <div className="relative overflow-hidden rounded-[5px] border-2 border-[var(--border)] shadow-inner" style={{ width: px(w), height: px(h), background: pos === "bottom" ? "#c62128" : "#8cc63f" }}>
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
              <div className="absolute cursor-pointer" onClick={() => setSel("qr")} style={{ left: px(qrBox.left), top: px(qrBox.top), width: px(qrBox.size), height: px(qrBox.size), ...selStyle("qr") }}><QrGlyph bg={pos === "bottom" ? "#fff" : "#8cc63f"} /></div>
              {/* text attributes — each independently placed */}
              <div className="absolute cursor-pointer font-mono font-extrabold leading-none text-black" onClick={() => setSel("code")} style={{ left: px(codeB.left), top: px(codeB.top), fontSize: px(FONT_MM[fontOf("code")]), ...selStyle("code") }}>{sample.code}</div>
              <div className="absolute cursor-pointer font-mono font-bold leading-tight text-black" onClick={() => setSel("name")} style={{ left: px(nameB.left), top: px(nameB.top), fontSize: px(FONT_MM[fontOf("name")]), maxWidth: px(w - nameB.left - 1), ...selStyle("name") }}>{sample.name}</div>
              <div className="absolute cursor-pointer font-mono leading-none text-black" onClick={() => setSel("qty")} style={{ left: px(qtyB.left), top: px(qtyB.top), fontSize: px(FONT_MM[fontOf("qty")]), ...selStyle("qty") }}>{sample.qty}</div>
              <div className="absolute cursor-pointer font-mono leading-none text-black" onClick={() => setSel("mrp")} style={{ left: px(mrpB.left), top: px(mrpB.top), fontSize: px(FONT_MM[fontOf("mrp")]), ...selStyle("mrp") }}>{sample.mrp}</div>
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
                Text size {els[sel]?.f ? "" : "(auto)"}
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6].map((f) => (
                    <button key={f} onClick={() => setEl(sel, { f })}
                      className={`flex-1 rounded-md border py-1.5 text-xs font-bold ${curFont === f ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)] bg-white hover:bg-[var(--surface-2)]"}`}>
                      {["", "XS", "S", "M", "L", "XL", "XXL"][f]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sel === "all" && (
              <p className="text-xs text-[var(--muted)]">Moves <b>every</b> attribute together. To move just one (QR, Name…), pick it in the tabs above.</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => { if (sel === "all") { setOx(0); setOy(0); } else setEls((m) => { const c = { ...m }; delete c[sel]; return c; }); }}
                className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Reset this</button>
              <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-[var(--accent-2)] px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save all"}</button>
            </div>
            <button onClick={() => { setOx(0); setOy(0); setEls({}); }} className="text-xs font-semibold text-[var(--muted)] underline hover:text-[var(--accent-strong)]">Reset the whole label to auto</button>
            <p className="text-[10px] text-[var(--muted-2)]">Saved for this size and shared with every ERP PC — applied automatically on every print.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
