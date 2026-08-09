import "server-only";
import QRCode from "qrcode";

// PrintNode bridge: the dashboard (cloud) sends raw TSPL to the TSC label
// printers via PrintNode's API. A small PrintNode client runs on each ERP PC
// and delivers the raw commands straight to the printer — which is what finally
// got around Windows swallowing raw print data.

const API = "https://api.printnode.com";
function authHeader(): string {
  const key = process.env.PRINTNODE_API_KEY || "";
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

export type PnPrinter = {
  id: number; name: string; state: string;
  computer: string; computerId: number; computerState: string;
};

export async function listPrinters(): Promise<PnPrinter[]> {
  const r = await fetch(`${API}/printers`, { headers: { Authorization: authHeader() }, cache: "no-store" });
  if (!r.ok) throw new Error(`PrintNode /printers ${r.status}`);
  const d = (await r.json()) as Array<Record<string, unknown>>;
  return d.map((p) => {
    const comp = (p.computer ?? {}) as Record<string, unknown>;
    return {
      id: Number(p.id), name: String(p.name), state: String(p.state),
      computer: String(comp.name ?? ""), computerId: Number(comp.id ?? 0),
      computerState: String(comp.state ?? ""),
    };
  });
}

// After sending, confirm each job actually printed. PrintNode states progress
// new → sent_to_client → queued → in_progress → done; reaching in_progress/done
// means paper moved. Stuck at queued = the printer is asleep/offline (phantom).
export async function jobStates(ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(`${API}/printjobs/${id}/states`, { headers: { Authorization: authHeader() }, cache: "no-store" });
      const d = await r.json();
      const states: string[] = [];
      if (Array.isArray(d)) for (const grp of d) if (Array.isArray(grp)) for (const s of grp) if (s?.state) states.push(String(s.state));
      out[id] = states.includes("done") ? "done" : states.includes("in_progress") ? "in_progress" : states.slice(-1)[0] || "unknown";
    } catch { out[id] = "unknown"; }
  }));
  return out;
}

export type LabelData = {
  sku_code: string; qrToken: string; name: string; type: "single" | "master";
  masterQty: number; singleQty: number; unit: string; price: number;
  // lot/rack are kept in the data model for the future Lot No / Rack No menus,
  // but are deliberately NOT printed on the label for now.
  lot?: string; rack?: string; pkd?: string;
};

// ── TSPL builder ─────────────────────────────────────────────────────────
// 203 dpi = 8 dots/mm. Layout: a big QR on the left; on the right the SKU code,
// the full product name (up to 2 lines), and qty/MRP. No Single/Master tier
// line, no lot/rack. Everything sits in the TOP area so the label's pre-printed
// address (bottom ~38%) stays clear. DIRECTION 0 = right-side up on these rolls.
const F_WIDTH: Record<string, number> = { "1": 8, "2": 12, "3": 16, "4": 24, "5": 32 };
const F_HEIGHT: Record<string, number> = { "1": 12, "2": 20, "3": 24, "4": 32, "5": 48 };
function fitText(s: string, font: string, maxDots: number): string {
  const w = F_WIDTH[font] || 16;
  const max = Math.max(3, Math.floor(maxDots / w));
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "." : s;
}
// Word-wrap to as many lines as the full text needs (no dropping) — hard-breaking
// any single word wider than the line. Used to auto-fit the whole product name.
function wrapAll(s: string, font: string, maxDots: number): string[] {
  const cw = F_WIDTH[font] || 16;
  const maxChars = Math.max(4, Math.floor(maxDots / cw));
  // Hard-break any word longer than a full line into <=maxChars chunks FIRST, so the
  // leftover fragment (e.g. the "S" of "…PESS") is treated as a normal word and the
  // NEXT words ("PRO NEW") pack onto the same line instead of each dropping down.
  const words: string[] = [];
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (w.length <= maxChars) words.push(w);
    else for (let i = 0; i < w.length; i += maxChars) words.push(w.slice(i, i + maxChars));
  }
  const out: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (test.length > maxChars && cur) { out.push(cur); cur = word; } else cur = test;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

// TSPL TEXT has no auto-wrap, so word-wrap the name to at most `maxLines` lines.
function wrapText(s: string, font: string, maxDots: number, maxLines: number): string[] {
  const cw = F_WIDTH[font] || 16;
  const maxChars = Math.max(4, Math.floor(maxDots / cw));
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (test.length > maxChars && cur) {
      lines.push(cur); cur = word;
      if (lines.length >= maxLines) break;
    } else cur = test;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines).map((l) => (l.length > maxChars ? l.slice(0, maxChars) : l));
}
const esc = (s: unknown) => String(s ?? "").replace(/["\r\n]/g, " ").trim();

// Per-size layout: `pos` says which end carries the pre-printed address (so we
// print into the OTHER half); the optional mm overrides let the operator nudge.
// `elements` lets the operator position/size EACH attribute independently (from
// the visual aligner): key = qr|code|name|qty|mrp, dx/dy = mm nudge from the auto
// position, f = font 1–5 (text), sz = QR size in mm. Absent/0 = keep auto.
export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number; b?: number; mm?: number };
export type LayoutOpts = { qrMM?: number; topMM?: number; leftMM?: number; large?: boolean; pos?: "top" | "bottom"; dpi?: number; density?: number; speed?: number; offsetXmm?: number; offsetYmm?: number; elements?: Record<string, ElOverride>; design?: number };

export function buildTSPL(l: LabelData, w: number, h: number, opts: LayoutOpts = {}): Buffer {
  // Two selectable templates per size: Design 1 (default, big-name layout below) and
  // Design 2 (classic header: CODE + full-width name on top, QR bottom-left, details
  // to its right). The choice is saved per size and never resets.
  if (opts.design === 2) return buildTSPLDesign2(l, w, h, opts);
  // Dots per mm depends on the printer's RESOLUTION. TTP-244 Plus/Pro = 203 dpi
  // (8 dots/mm); TTP-345 = 300 dpi (~11.81 dots/mm). All x/y/size are in dots,
  // so using the wrong dp squashes the print into a corner on a 300 dpi head.
  const dpi = opts.dpi && opts.dpi >= 280 ? opts.dpi : 203;
  const dp = dpi === 203 ? 8 : dpi / 25.4;
  const hires = dpi >= 280;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
  // Operator alignment nudge (from the visual aligner), in mm → dots.
  // LOCKED sizes use a FIXED layout that ignores ALL aligner customisation (offsets,
  // per-element moves/sizes) — only we can change them here in code. This keeps the
  // big green 95×70 and the 70×40 medium green consistent no matter what an operator
  // does in the 🎯 Align tool.
  // ALL sizes are locked: the barcode + text placement is fixed per size and the
  // 🎯 Align tool can no longer shift anything. The ONLY way to control how a name
  // reads is the Barcode Master's line breaks (Line 1/2/3); everything else auto-fits
  // (breaks to more lines / steps the font down) so the FULL name always prints.
  const lockedSize = false; // aligner nudges (offsets/per-element) are honoured again, on top of each size's layout
  const ox = lockedSize ? 0 : Math.round((opts.offsetXmm ?? 0) * dp);
  const oy = lockedSize ? 0 : Math.round((opts.offsetYmm ?? 0) * dp);
  // Per-element overrides (from the visual aligner). dx/dy in mm → dots; f = font.
  const el = lockedSize ? {} : (opts.elements || {});
  const emx = (k: string) => Math.round(((el[k]?.dx) || 0) * dp);
  const emy = (k: string) => Math.round(((el[k]?.dy) || 0) * dp);
  // Maps an override font level to a TSPL font + magnification. Levels 1–5 are the
  // native fonts; 6 = XXL (biggest font at 2×), 7 = 3× — TSPL has no font >5, so
  // we scale via the TEXT x/y-multiplier instead.
  // Printed height (mm) of a base font at 1× on this head. Magnification (1–3×)
  // multiplies it, so {font 1–5}×{mag 1–3} gives a fine ladder of real sizes.
  const baseMM = (bf: number) => (F_HEIGHT[String(bf)] || 24) / dp;
  const emFont = (k: string, def: string): { font: string; mag: number } => {
    // Exact mm target from the aligner wins: pick the (font, magnification) whose
    // printed height is closest to the requested mm — real continuous-ish sizing.
    const mm = el[k]?.mm;
    if (mm && mm > 0) {
      // Prefer a NATIVE bitmap font (mag 1) — magnifying a small font makes the
      // glyphs blocky/pixelated. If the target fits within the native range (up to
      // the largest built-in font, ~6mm @203dpi), snap to the closest native font.
      // Only magnify font 5 for sizes bigger than any native font (rare XXL).
      const nativeMaxMM = baseMM(5);
      if (mm <= nativeMaxMM + 0.75) {
        let best = { font: def, err: Infinity };
        for (const bf of [1, 2, 3, 4, 5]) {
          const err = Math.abs(baseMM(bf) - mm);
          if (err < best.err - 1e-9) best = { font: String(bf), err };
        }
        return { font: best.font, mag: 1 };
      }
      let best = { font: "5", mag: 1, err: Infinity };
      for (let mag = 1; mag <= 3; mag++) { const err = Math.abs(baseMM(5) * mag - mm); if (err < best.err) best = { font: "5", mag, err }; }
      return { font: best.font, mag: best.mag };
    }
    const f = el[k]?.f;
    if (f && f >= 1 && f <= 5) return { font: String(f), mag: 1 };
    if (f && f >= 6) return { font: "5", mag: Math.min(3, f - 4) };
    return { font: def, mag: 1 };
  };
  const pad = Math.round(2 * dp);
  // Inter-line gap. The red 85×55 packs a lot (big name + qty + MRP + attributes) into
  // a small area, so it uses a tighter gap to fit a bigger name; other sizes unchanged.
  const lineGap = Math.round((w === 85 && h === 55 ? 0.3 : 0.6) * dp);
  const lh = (f: string) => (F_HEIGHT[f] || 24) + lineGap;
  // Effective line height for an element, honouring its override magnification
  // (equals lh(def) when there's no size override, so untweaked labels are unchanged).
  const elh = (k: string, def: string) => { const { font, mag } = emFont(k, def); return (F_HEIGHT[font] || 24) * mag + lineGap; };

  // ── White printable zone ─────────────────────────────────────────────────
  // The pre-printed address sits on one end (~30% of the label); we print into
  // the rest. `pos: "top"` = address at bottom → print in the TOP zone (green
  // labels); `"bottom"` = banner at top → print in the BOTTOM zone (red label).
  // The red 85×55 stock has its banner at the TOP → always print in the lower
  // white area. The 50×30 has extra room below → give it a taller zone (bigger QR).
  const red = w === 85 && h === 55;
  const tiny = w === 50 && h === 30;
  // All the small/medium greens get the big-name "hero" fill (like the big green):
  // 70×40, 65×35 and the 50×30 (2-up). QR on the right replaces the old 1D barcode.
  const heroSmall = (w === 70 && h === 40) || (w === 65 && h === 35) || (w === 50 && h === 30);
  const pos = red || opts.pos === "bottom" ? "bottom" : "top";
  const top = opts.topMM != null
    ? Math.max(0, Math.round(opts.topMM * dp))
    : Math.round(Hd * (red ? 0.30 : heroSmall ? 0.05 : pos === "bottom" ? 0.36 : 0.07)); // clear the banner/give the code top margin
  // Content zone kept comfortably clear of the pre-printed address band so it never
  // overprints it. The red 85×55 & 70×40 use more of their white area for big text.
  const bottom = Math.round(Hd * (red ? 0.94 : heroSmall ? 0.72 : pos === "bottom" ? 0.92 : 0.63));
  const zoneH = Math.max(25, bottom - top);
  const downShift = Math.round(2 * dp); // small nudge down so it doesn't clip the top edge

  // QR rendered as a BITMAP (like BarTender) with a built-in 4-module quiet zone,
  // sized to the biggest module that fits the zone height and ~half the width.
  const qr = QRCode.create(l.qrToken, { errorCorrectionLevel: "M" });
  const qrN = qr.modules.size;
  const QUIET = 4;
  const qrTotal = qrN + QUIET * 2; // modules incl. quiet zone
  // Cap the QR box at ~28mm so it doesn't dominate the big labels and starve the
  // text of width (it's still a big, easily-scanned code with its quiet zone).
  const bigLbl = h >= (hires ? 44 : 54) || (!!opts.large && h >= 40); // 95×70 (& 85×55) = big
  // The big GREEN (95×70) and the 70×40 get the QR-right / text-left "hero" fill
  // layout (big bold name); the red keeps its QR-left layout.
  const fillBig = !red && ((w === 95 && h === 70) || heroSmall);
  const maxBox = Math.min(zoneH - downShift - Math.round((tiny ? 0 : 1) * dp), Math.floor(Wd * (tiny ? 0.42 : 0.5)), Math.round((heroSmall ? Math.min(20, h * 0.5) : bigLbl ? 32 : 28) * dp));
  // QR size: per-element (aligner) mm wins, then legacy whole-block qrMM, else auto.
  const qrSzMM = (el.qr?.sz && el.qr.sz > 0) ? el.qr.sz : (opts.qrMM && opts.qrMM > 0 ? opts.qrMM : 0);
  const modDots = qrSzMM > 0
    ? Math.max(2, Math.floor((qrSzMM * dp) / qrTotal))
    : Math.max(2, Math.floor(maxBox / qrTotal));
  const qrPx = qrTotal * modDots; // full QR box (black symbol + quiet zone)
  // QR position (final, incl. aligner nudge). On the BIG label the QR is parked in
  // the BOTTOM-RIGHT corner and ALL text is left-aligned across the rest — matches
  // the reference and never squeezes the name. Other sizes: QR on the left, centred.
  // The big green uses a FIXED reference layout, so it ignores the saved aligner
  // nudges (which were pushing the text off the left edge); other sizes honour them.
  const qrX = (fillBig
    ? Wd - qrPx - Math.round(4 * dp)
    : (opts.leftMM != null ? Math.max(0, Math.round(opts.leftMM * dp)) : Math.round(5 * dp))) + ox + emx("qr");
  let qrY = fillBig
    ? bottom - qrPx
    : top + downShift + Math.max(0, Math.round(((zoneH - downShift) - qrPx) / 2));
  if (!fillBig) qrY = Math.max(top, Math.min(bottom - qrPx, qrY));
  qrY = Math.max(0, Math.min(Hd - qrPx, qrY + oy + emy("qr"))); // aligner vertical nudge, clamped to the label

  // Text column. Big label: LEFT-aligned, full width up to the QR (bottom-right), so
  // the whole name fits and reads left-aligned. Other sizes: right of the left QR.
  // The RED 85×55 stock has a HOLOGRAM security strip down its right edge (~14mm),
  // so text must stop before it or it prints under the hologram and looks cut.
  const rMar = Math.round((red ? 14 : bigLbl ? 4 : 2) * dp);
  // Big: QR on the right — clamp its left edge on-label so the text width is sane.
  // Non-big: QR on the left at its actual x.
  const qrLnow = fillBig ? Math.max(Math.round(30 * dp), Math.min(qrX, Wd - qrPx)) : Math.max(0, qrX);
  const qrRnow = Math.min(Wd, qrLnow + qrPx);
  let textX: number, textW: number;
  if (fillBig) {
    textX = Math.round((heroSmall ? 4 : 1.5) * dp) + ox; // hero left margin + aligner nudge
    // name/text spans left→ up to the QR's left edge (or full width above the QR)
    textW = Math.max(6 * dp, qrLnow - textX - Math.round(3 * dp));
  } else {
    textX = qrRnow + Math.round(2 * dp);
    textW = Math.max(4 * dp, Wd - textX - rMar);
  }

  // Fonts scale with height (with a "large" bump). 85×55 & 95×70 = big,
  // 70×40 = medium (was tiny), 50×30 = small. On a 300 dpi head the bitmap fonts
  // are physically ~⅔ the size, so bump each label up a tier to compensate.
  const big = bigLbl;
  const med = h >= (hires ? 30 : 38) || (!!opts.large && h >= 26);
  const qtyStr = l.type === "master" ? `QTY:${l.masterQty} ${l.unit}` : `Qty.${l.singleQty || 1} ${l.unit}`;
  const mrpStr = `MRP.Rs.${Math.round(l.price)}/-`;

  // Extra attributes printed below MRP (like the reference label), in this order:
  //   (Incl. of All Taxes) · Lot No · PKD (packed date) · Rack No.
  // Lot/Rack show their value if the SKU has one, else the field stays blank;
  // PKD defaults to TODAY (the print date) unless a date is supplied.
  const today = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; })();
  const allExtras: string[] = [
    "(Incl. of All Taxes)",
    `Lot No: ${esc(l.lot ?? "")}`.trimEnd(),
    `PKD: ${l.pkd ? esc(l.pkd) : today}`,
    `Rack No: ${esc(l.rack ?? "")}`.trimEnd(),
  ];

  // Auto-fit: pick the LARGEST font tier [code, name, qty/mrp, extras] at which the
  // code + qty + MRP + all four attribute lines + the (wrapped) name all fit the
  // white zone. Short names / big labels land on a bigger tier; when there's a lot
  // to show, the text steps down a tier so nothing is dropped or overprints the band.
  const fitRoom = zoneH - Math.round(1.5 * dp);
  // If the name carries MANUAL line breaks (operator-set, saved per SKU) we honour
  // them exactly (up to 3 lines); otherwise we auto-wrap to the label width.
  const rawName = String(l.name ?? "");
  const manualSegs = rawName.split(/\r?\n/).map((s) => esc(s)).filter((s) => s.length > 0).slice(0, 3);
  const useManual = manualSegs.length > 1;
  // Allow enough name lines that the FULL name always fits (it breaks to more lines
  // / steps the font down rather than ever truncating). Big label up to 4, others up to 3.
  const nameCap = useManual ? manualSegs.length : (bigLbl || heroSmall ? 4 : 3);
  const linesFor = (nf: string) => (useManual ? manualSegs : wrapAll(esc(rawName), nf, textW));
  const tiers: [string, string, string, string][] = big
    ? [["5", "5", "4", "3"], ["4", "4", "3", "2"], ["3", "3", "2", "2"], ["2", "2", "2", "1"]]
    : med
    ? [["4", "4", "3", "2"], ["3", "3", "2", "2"], ["2", "2", "2", "1"]]
    : [["3", "3", "2", "1"], ["2", "2", "1", "1"], ["2", "1", "1", "1"]];
  // max name lines a tier allows once code + qty + mrp + ALL extras are reserved
  const tierNL = (t: [string, string, string, string]) =>
    Math.floor((fitRoom - (lh(t[0]) + 2 * lh(t[2]) + allExtras.length * lh(t[3]))) / lh(t[1]));
  let chosen: [string, string, string, string] | null = null;
  let nameLines: string[] = [];
  if (useManual) {
    // Operator-set line breaks win. Prefer the largest tier that fits the N name
    // lines AND all extras; else the largest that fits the N name lines (extras then
    // gated to what's left); else the smallest tier with as many name lines as fit.
    const N = manualSegs.length;
    const core = (t: [string, string, string, string]) => lh(t[0]) + N * lh(t[1]) + 2 * lh(t[2]);
    for (const t of tiers) { if (core(t) + allExtras.length * lh(t[3]) <= fitRoom) { chosen = t; nameLines = manualSegs; break; } }
    if (!chosen) for (const t of tiers) { if (core(t) <= fitRoom) { chosen = t; nameLines = manualSegs; break; } }
    if (!chosen) {
      chosen = tiers[tiers.length - 1];
      const maxN = Math.max(1, Math.floor((fitRoom - lh(chosen[0]) - 2 * lh(chosen[2])) / lh(chosen[1])));
      nameLines = manualSegs.slice(0, maxN);
    }
  } else {
    for (const t of tiers) { // pass 1: full name (≤ cap) + all extras
      const wrapped = linesFor(t[1]);
      const need = Math.min(wrapped.length || 1, nameCap);
      if (tierNL(t) >= need) { chosen = t; nameLines = wrapped.slice(0, need); break; }
    }
    if (!chosen) for (const t of tiers) { // pass 2: ≥ 1 name line + all extras
      if (tierNL(t) >= 1) { chosen = t; nameLines = linesFor(t[1]).slice(0, Math.min(tierNL(t), nameCap)); break; }
    }
    if (!chosen) { chosen = tiers[tiers.length - 1]; nameLines = linesFor(chosen[1]).slice(0, 1); } // pass 3: smallest, gate extras
  }
  if (fillBig && !useManual) {
    // "Hero" fill (95×70 & 70×40): the NAME is the big bold star. Use the largest
    // font at which the name (≤ maxL lines) + qty + MRP + the key attributes fit;
    // short names print big, long ones step down a font. The CODE prints one step
    // below the name, so we reserve the code line at (name font − 1).
    const bigTiers: { f: [string, string, string, string]; maxL: number }[] = [
      { f: ["5", "5", "3", "2"], maxL: 2 },
      { f: ["4", "4", "3", "2"], maxL: 3 },
      { f: ["3", "3", "2", "2"], maxL: 4 },
      { f: ["2", "2", "2", "1"], maxL: 4 },
    ];
    // 70×40 is short — force fewer attribute lines so the name can stay big (the gate
    // still fills in extras below if there's room).
    const KEEP = heroSmall ? 1 : 3;
    const codeRes = (nf: string) => heroSmall ? lh(String(Math.max(2, Number(nf) - 1))) : lh(nf); // 70×40 code=name−1; big green code=name
    let bc: [string, string, string, string] | null = null;
    for (const t of bigTiers) { // prefer: name fully shown + the key attributes fit
      const wr = wrapAll(esc(rawName), t.f[1], textW);
      if (wr.length > t.maxL) continue;
      if (codeRes(t.f[1]) + wr.length * lh(t.f[1]) + 2 * lh(t.f[2]) + KEEP * lh(t.f[3]) <= fitRoom) { bc = t.f; nameLines = wr; break; }
    }
    if (!bc) for (const t of bigTiers) { // fallback: at least fit the name (extras gated after)
      const wr = wrapAll(esc(rawName), t.f[1], textW);
      if (wr.length <= t.maxL && codeRes(t.f[1]) + wr.length * lh(t.f[1]) + 2 * lh(t.f[2]) <= fitRoom) { bc = t.f; nameLines = wr; break; }
    }
    chosen = bc ?? (["2", "2", "2", "1"] as [string, string, string, string]);
    if (!bc) nameLines = wrapAll(esc(rawName), "2", textW).slice(0, 4);
  }
  const [skuF, nameF0, qtyF, exF0] = chosen;

  // Width-fit so text is never CUT mid-string on narrow (small) labels: shrink the
  // NAME font until the full name fits nameCap lines, and the ATTRIBUTE font until
  // the widest line ("(Incl. of All Taxes)") fits the text column beside the QR.
  let nameF = nameF0;
  if (!useManual) {
    let wr = wrapAll(esc(rawName), nameF, textW);
    while (Number(nameF) > 1 && wr.length > nameCap) { nameF = String(Number(nameF) - 1); wr = wrapAll(esc(rawName), nameF, textW); }
    nameLines = wr.slice(0, nameCap);
  } else {
    const wN = nameLines.reduce((m, s) => Math.max(m, s.length), 1);
    while (Number(nameF) > 1 && wN * (F_WIDTH[nameF] || 16) > textW) nameF = String(Number(nameF) - 1);
  }
  let exF = exF0;
  { const wE = allExtras.reduce((m, e) => Math.max(m, e.length), 1); while (Number(exF) > 1 && wE * (F_WIDTH[exF] || 16) > textW) exF = String(Number(exF) - 1); }

  // CODE line: on the big green the PRODUCT NAME is the hero, so the code prints one
  // font-step SMALLER than the name (name always reads bigger). Shrink further only if
  // the full code wouldn't fit the width. Never truncated.
  const codeStr = esc(l.sku_code); // just the SKU (no "CODE:" prefix)
  let codeF = fillBig ? (heroSmall ? String(Math.max(2, Number(nameF) - 1)) : nameF) : skuF; // big green: code as big as the name
  while (Number(codeF) > 1 && codeStr.length * (F_WIDTH[codeF] || 16) > textW) codeF = String(Number(codeF) - 1);

  // Effective NAME size. Without an aligner override this is just the auto font.
  // With one, the requested size is a TARGET: use it when the full (wrapped) name +
  // code + qty + MRP fit the label, but step DOWN for a name too long to fit at that
  // size — so a long name never overflows and shoves the rest of the label around,
  // and the operator still never has to add per-SKU line breaks.
  const nlh = (c: { font: string; mag: number }) => (F_HEIGHT[c.font] || 24) * c.mag + lineGap;
  let nameEff = emFont("name", nameF);

  // ── RED 85×55 special layout ──────────────────────────────────────────────
  // Code CENTRED above the QR (top-left); QR sits HIGH; and ONLY the "Rack No" line
  // prints BELOW the QR so it is never cut by a long name. The other attributes
  // (Incl of Taxes / Lot / PKD) stay in the right column under the MRP. The code no
  // longer takes a right-column line (it's above the QR).
  const codeOverQr = red;
  const rackBelowQr = red;
  // Push the code+QR block to the very top of the white zone (QR "up").
  if (codeOverQr) qrY = Math.max(top, top + elh("code", codeF)); // code+QR pushed to the very top
  const rackLine = `Rack No: ${esc(l.rack ?? "")}`.trimEnd();
  const rackY = rackBelowQr ? qrY + qrPx + Math.round(0.8 * dp) : 0; // Rack sits a little higher, right under the QR
  // Right-column attributes: on red, everything EXCEPT Rack No (which prints below QR).
  const colExtras = rackBelowQr ? allExtras.filter((e) => !e.startsWith("Rack No")) : allExtras;

  // Name sizing = TARGET with step-down: normal names print big; a long name steps
  // down to the largest size at which the FULL name + qty + MRP + ALL right-column
  // attributes (Incl/Lot/PKD) fit — so a long name never squeezes out Lot or PKD.
  if (!useManual && (fillBig || el.name?.mm || el.name?.f)) {
    const start = emFont("name", nameF);
    const cands: { font: string; mag: number }[] = [];
    const seenH = new Set<number>();
    for (let bf = Number(start.font); bf >= 1; bf--) {
      for (let mag = (bf === Number(start.font) ? start.mag : 3); mag >= 1; mag--) {
        const hh = (F_HEIGHT[String(bf)] || 24) * mag;
        if (seenH.has(hh)) continue; seenH.add(hh);
        cands.push({ font: String(bf), mag });
      }
    }
    let picked = cands[0], pickedLines = nameLines;
    for (const c of cands) {
      const availW = Math.max(1, Math.floor(textW / c.mag)); // magnified glyphs are wider
      const wr = wrapAll(esc(rawName), c.font, availW);
      const need = (codeOverQr ? 0 : elh("code", codeF)) + wr.length * nlh(c) + elh("qty", qtyF) + elh("mrp", qtyF) + colExtras.length * elh("extras", exF);
      picked = c; pickedLines = wr;
      if (need <= fitRoom) break; // largest size at which name + qty + MRP + attributes all fit
    }
    nameEff = picked;
    nameLines = pickedLines.slice(0, 8);
  }

  const baseH = (codeOverQr ? 0 : elh("code", codeF)) + nameLines.length * nlh(nameEff) + elh("qty", qtyF) + elh("mrp", qtyF);
  let nEx = 0;
  if (rackBelowQr) {
    nEx = colExtras.length; // red: the name was sized to fit them all, so always show Incl/Lot/PKD
  } else {
    while (nEx < colExtras.length && baseH + (nEx + 1) * elh("extras", exF) <= fitRoom) nEx++;
  }
  const extras = colExtras.slice(0, nEx);

  const contentH = baseH + extras.length * elh("extras", exF);
  // On the BIG label (95×70) spread the lines DOWN the whole zone so the content
  // fills the sticker like the reference label, instead of a compact block at the
  // top. Smaller labels stay compact & centred against the QR.
  const totalLines = 1 + nameLines.length + 2 + extras.length;
  const spread = fillBig ? Math.max(0, Math.min(Math.round((heroSmall ? 5 : 9) * dp), Math.floor((zoneH - contentH) / Math.max(1, totalLines)))) : 0;
  let cy;
  if (fillBig) {
    cy = top;
  } else if (codeOverQr) {
    cy = top; // red: name pushed to the very top of the white zone (right under the banner)
  } else {
    cy = qrY + Math.max(0, Math.round((qrPx - contentH) / 2)); // centre against the QR
    if (cy + contentH > bottom) cy = bottom - contentH;
    if (cy < top) cy = top;
  }

  // Each attribute is placed at its auto position, then nudged/resized by its own
  // override (dx/dy/font from the aligner). Base cy still advances by the auto font
  // height so moving/resizing one attribute doesn't shift the others.
  const rows: string[] = [];
  const fw = (mag: number) => Math.max(4 * dp, Math.floor(textW / mag)); // width budget shrinks as text magnifies
  // Emit a text line; if the element is BOLD (aligner toggle) overstrike it (print
  // again +1 dot across) to thicken the strokes — TSPL's built-in fonts have no bold.
  // The big green prints ALL text bold (overstruck) so long names at the smaller
  // font stay heavy and readable; other sizes bold only where the aligner set it.
  const emit = (k: string, x: number, y: number, font: string, mag: number, text: string) => {
    rows.push(`TEXT ${x},${y},"${font}",0,${mag},${mag},"${text}"`);
    if (fillBig || el[k]?.b) {
      // Bold = overstrike. On the hero fill labels we overstrike in BOTH directions
      // (+1 x and +1 y) for a heavier, clearly-bold look.
      rows.push(`TEXT ${x + 1},${y},"${font}",0,${mag},${mag},"${text}"`);
      if (fillBig) rows.push(`TEXT ${x},${y + 1},"${font}",0,${mag},${mag},"${text}"`);
    }
  };
  // On the big green the text is a FIXED left-aligned block, so ignore the saved
  // per-element X/Y nudges (they were shoving it back to the middle); other sizes keep them.
  const tdx = (k: string) => emx(k); // per-element horizontal nudge from the aligner
  const tdy = (k: string) => emy(k); // per-element vertical nudge from the aligner
  // `CODE:` prefix to match the reference label. `spread` (big label only) is added
  // after every line so the whole block fills the sticker top-to-bottom.
  if (codeOverQr) {
    // Code sits directly ABOVE the QR, CENTRED over the QR's width and fitted to it.
    // Its own dx/dy aligner nudges still apply for fine-tuning; the text column below
    // does NOT advance for it (name starts at the top).
    const { font, mag } = emFont("code", codeF);
    const codeTxt = fitText(codeStr, font, Math.max(4 * dp, qrPx));
    const codeW = codeTxt.length * (F_WIDTH[font] || 16) * mag;
    const codeXc = qrX + Math.max(0, Math.round((qrPx - codeW) / 2)); // centre over the QR
    const codeY = Math.max(top, qrY - elh("code", codeF));
    emit("code", codeXc + tdx("code"), codeY + tdy("code"), font, mag, codeTxt);
  } else {
    { const { font, mag } = emFont("code", codeF); emit("code", textX + tdx("code"), cy + tdy("code"), font, mag, fitText(codeStr, font, fw(mag))); }
    cy += elh("code", codeF) + spread; // advance by the CODE's real height (it may be bigger than the name)
  }
  { const { font, mag } = nameEff; let ny = cy + tdy("name"); for (const nl of nameLines) { emit("name", textX + tdx("name"), ny, font, mag, fitText(nl, font, fw(mag))); ny += nlh({ font, mag }) + spread; } }
  cy += nameLines.length * (nlh(nameEff) + spread);
  // QTY and MRP on SEPARATE lines — combined they overran the width and the MRP
  // got cut to "MRP.R." on the bigger labels. Each short line fits fully.
  { const { font, mag } = emFont("qty", qtyF); emit("qty", textX + tdx("qty"), cy + tdy("qty"), font, mag, fitText(esc(qtyStr), font, fw(mag))); }
  cy += elh("qty", qtyF) + spread;
  { const { font, mag } = emFont("mrp", qtyF); emit("mrp", textX + tdx("mrp"), cy + tdy("mrp"), font, mag, fitText(esc(mrpStr), font, fw(mag))); }
  cy += elh("mrp", qtyF) + spread;
  // Right-column attribute lines (Incl of Taxes / Lot / PKD) under the MRP.
  { const { font, mag } = emFont("extras", exF); let ey = cy + tdy("extras"); for (const e of extras) { emit("extras", textX + tdx("extras"), ey, font, mag, fitText(esc(e), font, fw(mag))); ey += lh(font) * mag + spread; } }
  // RED only: the Rack No block prints BELOW the QR, CENTRED under it. The LABEL sits
  // on line 1 and the actual RACK VALUE on line 2 (each centred, fitted to ~the QR
  // width) — so a long rack number never runs right into the Lot/PKD column. Empty
  // rack = just the "Rack No:" line. The block is clamped to the label bottom.
  if (rackBelowQr) {
    const { font, mag } = emFont("extras", exF);
    const rackVal = esc(String(l.rack ?? "").trim());
    const rackParts = rackVal ? ["Rack No:", rackVal] : ["Rack No:"];
    const rackBoxW = Math.max(4 * dp, qrPx + Math.round(8 * dp)); // ~QR width; keeps it left of the right column
    const lineDots = (F_HEIGHT[font] || 20) * mag + Math.round(0.35 * dp);
    let ry = Math.min(rackY, Hd - rackParts.length * lineDots); // clamp so the last line stays on-label
    for (const rl of rackParts) {
      const fit = fitText(rl, font, rackBoxW);
      const rw = fit.length * (F_WIDTH[font] || 16) * mag;
      const rx = qrX + Math.round((qrPx - rw) / 2); // centre each line under the QR
      emit("extras", rx + tdx("extras"), ry + tdy("extras"), font, mag, fit);
      ry += lineDots;
    }
  }

  // Assemble as binary (the QR bitmap carries raw bytes, so we can't use a
  // plain string). Lower density on the finer 300 dpi head keeps modules crisp.
  const bmp = renderQrBytes(qr, modDots, QUIET);
  // Darkness (DENSITY 1–15) and SPEED are the main QR print-quality knobs and are
  // printer/media-specific — operator-tunable, with crisp defaults (a bit lower on
  // the finer 300 dpi head, slow speed so modules form cleanly without bleeding).
  const density = opts.density != null && opts.density >= 1 ? Math.min(15, Math.round(opts.density)) : (hires ? 8 : 9);
  const speed = opts.speed != null && opts.speed >= 1 ? Math.min(6, opts.speed) : 2;
  // The 50×30 stock is 2-UP (two labels across per row) — print the QR+text twice,
  // offset by one label pitch, so BOTH die-cuts get their own barcode + text.
  const twoUp = w === 50 && h === 30;
  // Gap between the two die-cuts on the 50x30 2-up roll. These labels are
  // butt-cut (no gap), so 0 makes the right column mirror the (perfect) left one
  // exactly; a +2mm gap pushed the right label off its die-cut edge. Tune if your
  // roll actually has a physical gap between the two columns.
  const colGap = 0;
  const columns = twoUp ? 2 : 1;
  const pitch = Math.round((w + colGap) * dp);
  const sizeW = twoUp ? 2 * w + colGap : w;
  // Full print width in dots. For 2-up this spans BOTH die-cuts (~102mm); the QR
  // clamp must use this, not the single-label Wd, or column 2 gets pulled back
  // onto the first label (→ both barcodes on one sticker).
  const WdFull = Math.round(sizeW * dp);
  const head = [
    `SIZE ${sizeW} mm, ${h} mm`,
    `GAP 3 mm, 0 mm`,
    `DENSITY ${density}`,
    `SPEED ${speed}`,
    `DIRECTION 0`,
    `REFERENCE 0,0`,
    `CLS`,
    ``,
  ].join("\r\n");
  const buf: Buffer[] = [Buffer.from(head, "ascii")];
  for (let c = 0; c < columns; c++) {
    const xOff = c * pitch;
    const qbx = Math.max(0, Math.min(WdFull - bmp.sideDots, qrX + xOff)); // qrX already includes the aligner nudge
    const qby = Math.max(0, Math.min(Hd - bmp.sideDots, qrY));
    buf.push(Buffer.from(`BITMAP ${qbx},${qby},${bmp.widthBytes},${bmp.sideDots},0,`, "ascii"));
    buf.push(bmp.bytes);
    const colRows = rows.map((r) => r.replace(/^TEXT (\d+),/, (_m, x) => `TEXT ${Number(x) + xOff},`));
    buf.push(Buffer.from("\r\n" + colRows.join("\r\n") + "\r\n", "ascii"));
  }
  buf.push(Buffer.from(`PRINT 1,1\r\n`, "ascii"));
  return Buffer.concat(buf);
}

// ── DESIGN 2: classic header template ────────────────────────────────────────
// CODE:xxxx and the full-width product NAME across the top, the QR bottom-LEFT, and
// Qty / MRP / (Incl of Taxes) / Lot / PKD / Rack to the right of the QR. Matches the
// original red sticker. Everything is bold (overstruck). Self-contained + locked.
function buildTSPLDesign2(l: LabelData, w: number, h: number, opts: LayoutOpts = {}): Buffer {
  const dpi = opts.dpi && opts.dpi >= 280 ? opts.dpi : 203;
  const dp = dpi === 203 ? 8 : dpi / 25.4;
  const hires = dpi >= 280;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
  const pos = opts.pos === "bottom" ? "bottom" : "top";
  const red = w === 85 && h === 55;
  // White printable zone (below the top banner on red; above the bottom footer on green).
  const top = Math.round(Hd * (pos === "bottom" ? 0.30 : 0.06));
  const bottom = Math.round(Hd * (pos === "bottom" ? 0.94 : 0.72));
  const leftM = Math.round(4 * dp);
  const rMar = Math.round((red ? 14 : 3) * dp); // clear the hologram strip on red
  const colW = Math.max(10 * dp, Wd - leftM - rMar);
  const lh = (f: string) => (F_HEIGHT[f] || 24) + Math.round(0.5 * dp);
  const rows: string[] = [];
  const emit = (x: number, y: number, font: string, text: string) => {
    rows.push(`TEXT ${x},${y},"${font}",0,1,1,"${text}"`);
    rows.push(`TEXT ${x + 1},${y},"${font}",0,1,1,"${text}"`); // overstrike = bold
  };

  // Code header
  let cy = top;
  emit(leftM, cy, "3", fitText("CODE:" + esc(l.sku_code), "3", colW)); cy += lh("3") + Math.round(1 * dp);

  // Full-width NAME. Step the font down if it would need too many lines to leave room
  // for the QR + details block below.
  const rawName = esc(String(l.name ?? ""));
  const qrBoxMax = Math.round((hires ? 20 : 18) * dp);
  let nameF = "4";
  let nameLines = wrapAll(rawName, nameF, colW);
  // Reserve the FULL QR height below the name so the bottom-parked QR can never
  // ride up into the name; a long name steps its font down to fit above that.
  const nameRoom = bottom - cy - qrBoxMax - Math.round(2 * dp);
  while (Number(nameF) > 2 && nameLines.length * lh(nameF) > nameRoom) { nameF = String(Number(nameF) - 1); nameLines = wrapAll(rawName, nameF, colW); }
  for (const nl of nameLines) { emit(leftM, cy, nameF, fitText(nl, nameF, colW)); cy += lh(nameF); }
  cy += Math.round(1.5 * dp);

  // QR bottom-left
  const qr = QRCode.create(l.qrToken, { errorCorrectionLevel: "M" });
  const QUIET = 4; const qrTotal = qr.modules.size + QUIET * 2;
  const qrAvail = Math.max(Math.round(12 * dp), Math.min(qrBoxMax, bottom - cy));
  const modDots = Math.max(2, Math.floor(qrAvail / qrTotal));
  const qrPx = qrTotal * modDots;
  const bmp = renderQrBytes(qr, modDots, QUIET);
  // QR parked at the very BOTTOM-left (extremely low) — but kept inside the white
  // zone (bottom) so it never bleeds onto the next label on the roll.
  const qrX = leftM, qrY = Math.max(cy, bottom - qrPx);

  // Details to the right of the QR
  const dx0 = qrX + qrPx + Math.round(3 * dp);
  const dW = Math.max(6 * dp, Wd - dx0 - rMar);
  const qtyStr = l.type === "master" ? `QTY:${l.masterQty} ${l.unit}` : `Qty.${l.singleQty || 1} ${l.unit}`;
  const mrpStr = `MRP.Rs.${Math.round(l.price)}/-`;
  const today = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; })();
  const extras = ["(Incl. of All Taxes)", `Lot No: ${esc(l.lot ?? "")}`.trimEnd(), `PKD: ${l.pkd ? esc(l.pkd) : today}`, `Rack No: ${esc(l.rack ?? "")}`.trimEnd()];
  // Details fill the RIGHT column from just below the name (so all lines incl. Rack No
  // fit) while the QR sits low on the left. Start no lower than the QR top.
  let dy = Math.min(cy, qrY);
  emit(dx0, dy, "3", fitText(esc(qtyStr), "3", dW)); dy += lh("3");
  emit(dx0, dy, "3", fitText(esc(mrpStr), "3", dW)); dy += lh("3");
  for (const e of extras) { if (dy + lh("2") > bottom + Math.round(0.5 * dp)) break; emit(dx0, dy, "2", fitText(esc(e), "2", dW)); dy += lh("2"); }

  // Assemble
  const density = opts.density != null && opts.density >= 1 ? Math.min(15, Math.round(opts.density)) : (hires ? 8 : 9);
  const speed = opts.speed != null && opts.speed >= 1 ? Math.min(6, opts.speed) : 2;
  const head = [`SIZE ${w} mm, ${h} mm`, `GAP 3 mm, 0 mm`, `DENSITY ${density}`, `SPEED ${speed}`, `DIRECTION 0`, `REFERENCE 0,0`, `CLS`, ``].join("\r\n");
  const buf: Buffer[] = [Buffer.from(head, "ascii")];
  const qbx = Math.max(0, Math.min(Wd - bmp.sideDots, qrX));
  const qby = Math.max(0, Math.min(Hd - bmp.sideDots, qrY));
  buf.push(Buffer.from(`BITMAP ${qbx},${qby},${bmp.widthBytes},${bmp.sideDots},0,`, "ascii"));
  buf.push(bmp.bytes);
  buf.push(Buffer.from("\r\n" + rows.join("\r\n") + "\r\n", "ascii"));
  buf.push(Buffer.from(`PRINT 1,1\r\n`, "ascii"));
  return Buffer.concat(buf);
}

// Render a QR into a TSPL BITMAP payload: 1 bit per dot, MSB-first, rows padded
// to whole bytes. TSPL polarity: bit 0 = black (printed), bit 1 = white. A
// QUIET-module white border is baked in so hardware scanners lock on reliably.
function renderQrBytes(
  qr: { modules: { size: number; data: Uint8Array | number[] } },
  modDots: number,
  quiet: number,
): { bytes: Buffer; widthBytes: number; sideDots: number } {
  const N = qr.modules.size;
  const data = qr.modules.data;
  const sideDots = (N + quiet * 2) * modDots;
  const widthBytes = Math.ceil(sideDots / 8);
  const bytes = Buffer.alloc(widthBytes * sideDots, 0xff); // start all-white
  for (let my = 0; my < N; my++) {
    for (let mx = 0; mx < N; mx++) {
      if (!data[my * N + mx]) continue; // light module → leave white
      const px0 = (quiet + mx) * modDots;
      const py0 = (quiet + my) * modDots;
      for (let py = py0; py < py0 + modDots; py++) {
        const base = py * widthBytes;
        for (let px = px0; px < px0 + modDots; px++) {
          bytes[base + (px >> 3)] &= ~(0x80 >> (px & 7)); // clear bit → black
        }
      }
    }
  }
  return { bytes, widthBytes, sideDots };
}

export async function printLabels(printerId: number, labels: LabelData[], w: number, h: number, opts: LayoutOpts = {}) {
  const out: Array<{ token: string; ok: boolean; job?: unknown; error?: string }> = [];
  for (const l of labels) {
    const tspl = buildTSPL(l, w, h, opts);
    const body = {
      printerId,
      title: `Silver label ${l.qrToken}`,
      contentType: "raw_base64",
      content: tspl.toString("base64"),
      source: "silver-erp",
    };
    try {
      const r = await fetch(`${API}/printjobs`, {
        method: "POST",
        headers: { Authorization: authHeader(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) out.push({ token: l.qrToken, ok: true, job: await r.json() });
      else out.push({ token: l.qrToken, ok: false, error: `${r.status} ${await r.text()}` });
    } catch (e) {
      out.push({ token: l.qrToken, ok: false, error: String(e) });
    }
  }
  return out;
}
