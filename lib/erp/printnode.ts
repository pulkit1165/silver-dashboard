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
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const test = cur ? cur + " " + word : word;
    if (test.length > maxChars && cur) { out.push(cur); cur = word; } else cur = test;
  }
  if (cur) out.push(cur);
  return out.flatMap((l) => (l.length > maxChars ? (l.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [l]) : [l]));
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
export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number; b?: number };
export type LayoutOpts = { qrMM?: number; topMM?: number; leftMM?: number; large?: boolean; pos?: "top" | "bottom"; dpi?: number; density?: number; speed?: number; offsetXmm?: number; offsetYmm?: number; elements?: Record<string, ElOverride> };

export function buildTSPL(l: LabelData, w: number, h: number, opts: LayoutOpts = {}): Buffer {
  // Dots per mm depends on the printer's RESOLUTION. TTP-244 Plus/Pro = 203 dpi
  // (8 dots/mm); TTP-345 = 300 dpi (~11.81 dots/mm). All x/y/size are in dots,
  // so using the wrong dp squashes the print into a corner on a 300 dpi head.
  const dpi = opts.dpi && opts.dpi >= 280 ? opts.dpi : 203;
  const dp = dpi === 203 ? 8 : dpi / 25.4;
  const hires = dpi >= 280;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
  // Operator alignment nudge (from the visual aligner), in mm → dots.
  const ox = Math.round((opts.offsetXmm ?? 0) * dp);
  const oy = Math.round((opts.offsetYmm ?? 0) * dp);
  // Per-element overrides (from the visual aligner). dx/dy in mm → dots; f = font.
  const el = opts.elements || {};
  const emx = (k: string) => Math.round(((el[k]?.dx) || 0) * dp);
  const emy = (k: string) => Math.round(((el[k]?.dy) || 0) * dp);
  // Maps an override font level to a TSPL font + magnification. Levels 1–5 are the
  // native fonts; 6 = XXL (biggest font at 2×), 7 = 3× — TSPL has no font >5, so
  // we scale via the TEXT x/y-multiplier instead.
  const emFont = (k: string, def: string): { font: string; mag: number } => {
    const f = el[k]?.f;
    if (f && f >= 1 && f <= 5) return { font: String(f), mag: 1 };
    if (f && f >= 6) return { font: "5", mag: Math.min(3, f - 4) };
    return { font: def, mag: 1 };
  };
  const pad = Math.round(2 * dp);
  const lh = (f: string) => (F_HEIGHT[f] || 24) + Math.round(0.6 * dp);

  // ── White printable zone ─────────────────────────────────────────────────
  // The pre-printed address sits on one end (~30% of the label); we print into
  // the rest. `pos: "top"` = address at bottom → print in the TOP zone (green
  // labels); `"bottom"` = banner at top → print in the BOTTOM zone (red label).
  // The red 85×55 stock has its banner at the TOP → always print in the lower
  // white area. The 50×30 has extra room below → give it a taller zone (bigger QR).
  const red = w === 85 && h === 55;
  const tiny = w === 50 && h === 30;
  const pos = red || opts.pos === "bottom" ? "bottom" : "top";
  const top = opts.topMM != null
    ? Math.max(0, Math.round(opts.topMM * dp))
    : Math.round(Hd * (red ? 0.30 : pos === "bottom" ? 0.36 : 0.07)); // clear the banner/give the code top margin
  // Content zone kept comfortably clear of the pre-printed address band so it never
  // overprints it. The red 85×55 white panel is large, so we use more of it (more
  // room for the Lot/PKD/Rack lines). 203 dpi rounds the QR a touch bigger — margin covers it.
  const bottom = Math.round(Hd * (red ? 0.94 : pos === "bottom" ? 0.92 : 0.63));
  const zoneH = Math.max(25, bottom - top);
  const downShift = Math.round(2 * dp); // small nudge down so it doesn't clip the top edge
  const qrX = (opts.leftMM != null ? Math.max(0, Math.round(opts.leftMM * dp)) : Math.round(5 * dp)) + ox;

  // QR rendered as a BITMAP (like BarTender) with a built-in 4-module quiet zone,
  // sized to the biggest module that fits the zone height and ~half the width.
  const qr = QRCode.create(l.qrToken, { errorCorrectionLevel: "M" });
  const qrN = qr.modules.size;
  const QUIET = 4;
  const qrTotal = qrN + QUIET * 2; // modules incl. quiet zone
  // Cap the QR box at ~28mm so it doesn't dominate the big labels and starve the
  // text of width (it's still a big, easily-scanned code with its quiet zone).
  const bigLbl = h >= (hires ? 44 : 54) || (!!opts.large && h >= 40); // 95×70 (& 85×55) = big
  const maxBox = Math.min(zoneH - downShift - Math.round((tiny ? 0 : 1) * dp), Math.floor(Wd * (tiny ? 0.42 : 0.5)), Math.round((bigLbl ? 32 : 28) * dp));
  // QR size: per-element (aligner) mm wins, then legacy whole-block qrMM, else auto.
  const qrSzMM = (el.qr?.sz && el.qr.sz > 0) ? el.qr.sz : (opts.qrMM && opts.qrMM > 0 ? opts.qrMM : 0);
  const modDots = qrSzMM > 0
    ? Math.max(2, Math.floor((qrSzMM * dp) / qrTotal))
    : Math.max(2, Math.floor(maxBox / qrTotal));
  const qrPx = qrTotal * modDots; // full QR box (black symbol + quiet zone)
  let qrY = top + downShift + Math.max(0, Math.round(((zoneH - downShift) - qrPx) / 2));
  if (qrY + qrPx > bottom) qrY = bottom - qrPx; // clamp above the band
  if (qrY < top) qrY = top;
  qrY = Math.max(0, Math.min(Hd - qrPx, qrY + oy)); // apply the operator's vertical nudge (clamped to the label)
  const textX = qrX + qrPx + Math.round(2 * dp); // quiet zone already inside the box
  const textW = Math.max(4 * dp, Wd - textX - pad);

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
  const nameCap = useManual ? manualSegs.length : 2;
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
  if (big && !useManual) {
    // Big label (95×70): main text ~6mm tall (font 5) like the reference. Fit
    // CODE + name (≤2 lines) + qty + MRP WITHOUT reserving the attribute lines; the
    // extras then fill whatever's left, so the big text is never sacrificed for them.
    const bigTiers: [string, string, string, string][] = [["5", "5", "3", "2"], ["4", "4", "3", "2"], ["3", "3", "2", "2"]];
    let bc: [string, string, string, string] | null = null;
    for (const t of bigTiers) {
      const wr = wrapAll(esc(rawName), t[1], textW);
      const need = Math.min(wr.length || 1, 2);
      if (lh(t[0]) + need * lh(t[1]) + 2 * lh(t[2]) <= fitRoom) { bc = t; nameLines = wr.slice(0, need); break; }
    }
    chosen = bc ?? (["3", "3", "2", "2"] as [string, string, string, string]);
    if (!bc) nameLines = wrapAll(esc(rawName), "3", textW).slice(0, 2);
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

  const baseH = lh(skuF) + nameLines.length * lh(nameF) + 2 * lh(qtyF);
  let nEx = 0;
  while (nEx < allExtras.length && baseH + (nEx + 1) * lh(exF) <= fitRoom) nEx++;
  const extras = allExtras.slice(0, nEx);

  const contentH = baseH + extras.length * lh(exF);
  // On the BIG label (95×70) spread the lines DOWN the whole zone so the content
  // fills the sticker like the reference label, instead of a compact block at the
  // top. Smaller labels stay compact & centred against the QR.
  const totalLines = 1 + nameLines.length + 2 + extras.length;
  const spread = big ? Math.max(0, Math.min(Math.round(5 * dp), Math.floor((zoneH - contentH) / Math.max(1, totalLines)))) : 0;
  let cy;
  if (big) {
    cy = top;
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
  const emit = (k: string, x: number, y: number, font: string, mag: number, text: string) => {
    rows.push(`TEXT ${x},${y},"${font}",0,${mag},${mag},"${text}"`);
    if (el[k]?.b) rows.push(`TEXT ${x + 1},${y},"${font}",0,${mag},${mag},"${text}"`);
  };
  // `CODE:` prefix to match the reference label. `spread` (big label only) is added
  // after every line so the whole block fills the sticker top-to-bottom.
  { const { font, mag } = emFont("code", skuF); emit("code", textX + emx("code"), cy + emy("code"), font, mag, fitText((big || med ? "CODE:" : "") + esc(l.sku_code), font, fw(mag))); }
  cy += lh(skuF) + spread;
  { const { font, mag } = emFont("name", nameF); let ny = cy + emy("name"); for (const nl of nameLines) { emit("name", textX + emx("name"), ny, font, mag, fitText(nl, font, fw(mag))); ny += lh(font) * mag + spread; } }
  cy += nameLines.length * (lh(nameF) + spread);
  // QTY and MRP on SEPARATE lines — combined they overran the width and the MRP
  // got cut to "MRP.R." on the bigger labels. Each short line fits fully.
  { const { font, mag } = emFont("qty", qtyF); emit("qty", textX + emx("qty"), cy + emy("qty"), font, mag, fitText(esc(qtyStr), font, fw(mag))); }
  cy += lh(qtyF) + spread;
  { const { font, mag } = emFont("mrp", qtyF); emit("mrp", textX + emx("mrp"), cy + emy("mrp"), font, mag, fitText(esc(mrpStr), font, fw(mag))); }
  cy += lh(qtyF) + spread;
  // The attribute lines (Incl of Taxes / Lot / PKD / Rack) move & resize together
  // as one "extras" element from the aligner.
  { const { font, mag } = emFont("extras", exF); let ey = cy + emy("extras"); for (const e of extras) { emit("extras", textX + emx("extras"), ey, font, mag, fitText(esc(e), font, fw(mag))); ey += lh(font) * mag + spread; } }

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
  const colGap = 2;                        // mm between the two columns (tunable)
  const columns = twoUp ? 2 : 1;
  const pitch = Math.round((w + colGap) * dp);
  const sizeW = twoUp ? 2 * w + colGap : w;
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
    const qbx = Math.max(0, Math.min(Wd - bmp.sideDots, qrX + xOff + emx("qr")));
    const qby = Math.max(0, Math.min(Hd - bmp.sideDots, qrY + emy("qr")));
    buf.push(Buffer.from(`BITMAP ${qbx},${qby},${bmp.widthBytes},${bmp.sideDots},0,`, "ascii"));
    buf.push(bmp.bytes);
    const colRows = rows.map((r) => r.replace(/^TEXT (\d+),/, (_m, x) => `TEXT ${Number(x) + xOff},`));
    buf.push(Buffer.from("\r\n" + colRows.join("\r\n") + "\r\n", "ascii"));
  }
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
