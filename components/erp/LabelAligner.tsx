"use client";

import { useState } from "react";

export type Layout = { offsetX: number; offsetY: number; qrMM: number };

// A QR-like placeholder (finder patterns) so the preview shows the QR's box/position.
function QrGlyph() {
  return (
    <svg viewBox="0 0 21 21" className="h-full w-full" shapeRendering="crispEdges">
      <rect width="21" height="21" fill="#fff" />
      {[[0, 0], [14, 0], [0, 14]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="7" height="7" fill="#000" />
          <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
          <rect x={x + 2} y={y + 2} width="3" height="3" fill="#000" />
        </g>
      ))}
      {[[9, 2], [11, 4], [9, 6], [13, 9], [10, 10], [16, 11], [9, 13], [12, 14], [15, 15], [10, 17], [13, 18], [17, 9], [8, 9], [9, 9], [11, 11]].map(([x, y], i) => (
        <rect key={`d${i}`} x={x} y={y} width="1.4" height="1.4" fill="#000" />
      ))}
    </svg>
  );
}

export default function LabelAligner({
  sizeId, w, h, pos, sample, initial, onClose, onSaved,
}: {
  sizeId: string; w: number; h: number; pos: "top" | "bottom";
  sample: { code: string; name: string; qty: string; mrp: string };
  initial: Layout; onClose: () => void; onSaved: (l: Layout) => void;
}) {
  const [ox, setOx] = useState(initial.offsetX || 0);
  const [oy, setOy] = useState(initial.offsetY || 0);
  const [qrMM, setQrMM] = useState(initial.qrMM || 0);
  const [saving, setSaving] = useState(false);

  const SCALE = Math.max(4, Math.min(11, Math.floor(560 / w))); // px per mm
  const px = (mm: number) => mm * SCALE;

  // Zone + auto-QR mirror buildTSPL so the preview matches the print position.
  const zoneTop = h * (pos === "bottom" ? 0.36 : 0.08);
  const zoneBot = h * (pos === "bottom" ? 0.92 : 0.62);
  const zoneH = zoneBot - zoneTop;
  const autoQr = Math.max(8, Math.min(zoneH - 3, w * 0.5, 28));
  const qrSize = qrMM > 0 ? qrMM : autoQr;
  const qrLeft = 5 + ox;
  const qrTop = zoneTop + Math.max(0, (zoneH - qrSize) / 2) + oy;
  const textLeft = qrLeft + qrSize + 2;
  const fs = Math.max(6, px(2.6));

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/erp/labels/layout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sizeId, offsetX: ox, offsetY: oy, qrMM }),
      });
      onSaved({ offsetX: ox, offsetY: oy, qrMM });
    } finally { setSaving(false); }
  }

  const NudgeBtn = ({ label, on }: { label: string; on: () => void }) => (
    <button onClick={on} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-lg font-bold hover:bg-[var(--surface-2)] active:bg-[var(--accent-bg)]">{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-full overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-6">
          <h2 className="text-lg font-extrabold">🎯 Align label · {w} × {h} mm</h2>
          <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]">✕ Close</button>
        </div>

        <div className="flex flex-wrap items-start gap-6">
          {/* live preview */}
          <div>
            <div className="mb-1 text-xs font-bold uppercase text-[var(--muted)]">Print preview (actual size)</div>
            <div className="relative overflow-hidden rounded-[3px] border-2 border-[var(--border)] bg-white shadow-inner" style={{ width: px(w), height: px(h) }}>
              {/* pre-printed background band */}
              {pos === "bottom" ? (
                <div className="absolute inset-x-0 top-0 flex flex-col items-center justify-center bg-[#e11d2a] font-bold leading-tight text-white" style={{ height: px(h * 0.30), fontSize: Math.max(5, px(1.9)) }}>
                  <span>SILVER UP</span><span style={{ fontSize: Math.max(4, px(1.4)) }}>SILVER INDUSTRIES 50, OSWAL AGRO…</span>
                </div>
              ) : (
                <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center bg-[#eef07a] font-bold leading-tight text-[#c1121f]" style={{ height: px(h * 0.30), fontSize: Math.max(4, px(1.5)) }}>
                  <span>SILVER IND. 50, OSWAL IND. COMPLEX</span><span>G.T. ROAD, LUDHIANA-141010</span>
                </div>
              )}
              {/* content block */}
              <div className="absolute" style={{ left: px(qrLeft), top: px(qrTop), width: px(qrSize), height: px(qrSize) }}><QrGlyph /></div>
              <div className="absolute font-mono font-bold leading-tight text-black" style={{ left: px(textLeft), top: px(qrTop), fontSize: fs }}>
                <div>{sample.code}</div>
                <div>{sample.name}</div>
                <div style={{ fontSize: fs * 0.85, fontWeight: 400 }}>{sample.qty}</div>
                <div style={{ fontSize: fs * 0.85, fontWeight: 400 }}>{sample.mrp}</div>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-[var(--muted-2)]">Position &amp; QR size match the print; on-screen font is only an approximation.</p>
          </div>

          {/* controls */}
          <div className="flex w-52 flex-col gap-4">
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-[var(--muted)]">Move (0.5 mm steps)</div>
              <div className="flex flex-col items-center gap-1">
                <NudgeBtn label="▲" on={() => setOy((v) => Math.round((v - 0.5) * 10) / 10)} />
                <div className="flex gap-8">
                  <NudgeBtn label="◀" on={() => setOx((v) => Math.round((v - 0.5) * 10) / 10)} />
                  <NudgeBtn label="▶" on={() => setOx((v) => Math.round((v + 0.5) * 10) / 10)} />
                </div>
                <NudgeBtn label="▼" on={() => setOy((v) => Math.round((v + 0.5) * 10) / 10)} />
              </div>
              <div className="mt-2 text-center text-xs font-semibold text-[var(--muted)]">X {ox > 0 ? "+" : ""}{ox.toFixed(1)} · Y {oy > 0 ? "+" : ""}{oy.toFixed(1)} mm</div>
            </div>

            <label className="flex flex-col gap-1 text-xs font-bold uppercase text-[var(--muted)]">
              QR size — {qrSize.toFixed(0)} mm{qrMM === 0 ? " (auto)" : ""}
              <input type="range" min={8} max={Math.min(40, Math.floor(w * 0.5))} step={1}
                value={qrSize} onChange={(e) => setQrMM(Number(e.target.value))} className="accent-[var(--accent)]" />
            </label>

            <div className="flex gap-2">
              <button onClick={() => { setOx(0); setOy(0); setQrMM(0); }} className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-2)]">Reset</button>
              <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-[var(--accent-2)] px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
            <p className="text-[10px] text-[var(--muted-2)]">Saved for this size and shared with every ERP PC — applied automatically on every print.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
