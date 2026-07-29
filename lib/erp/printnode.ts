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
export type LayoutOpts = { qrMM?: number; topMM?: number; leftMM?: number; large?: boolean; pos?: "top" | "bottom"; dpi?: number; density?: number; speed?: number };

export function buildTSPL(l: LabelData, w: number, h: number, opts: LayoutOpts = {}): Buffer {
  // Dots per mm depends on the printer's RESOLUTION. TTP-244 Plus/Pro = 203 dpi
  // (8 dots/mm); TTP-345 = 300 dpi (~11.81 dots/mm). All x/y/size are in dots,
  // so using the wrong dp squashes the print into a corner on a 300 dpi head.
  const dpi = opts.dpi && opts.dpi >= 280 ? opts.dpi : 203;
  const dp = dpi === 203 ? 8 : dpi / 25.4;
  const hires = dpi >= 280;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
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
    : Math.round(Hd * (pos === "bottom" ? 0.36 : 0.08)); // more top margin so the SKU code isn't clipped
  // Content zone kept comfortably clear of the pre-printed address band so it
  // never overprints it — at EITHER resolution (203 dpi rounds the QR a touch
  // bigger, so we leave margin for that too).
  const bottom = Math.round(Hd * (pos === "bottom" ? 0.92 : 0.62));
  const zoneH = Math.max(25, bottom - top);
  const downShift = Math.round(2 * dp); // small nudge down so it doesn't clip the top edge
  const qrX = opts.leftMM != null ? Math.max(0, Math.round(opts.leftMM * dp)) : Math.round(5 * dp);

  // QR rendered as a BITMAP (like BarTender) with a built-in 4-module quiet zone,
  // sized to the biggest module that fits the zone height and ~half the width.
  const qr = QRCode.create(l.qrToken, { errorCorrectionLevel: "M" });
  const qrN = qr.modules.size;
  const QUIET = 4;
  const qrTotal = qrN + QUIET * 2; // modules incl. quiet zone
  // Cap the QR box at ~28mm so it doesn't dominate the big labels and starve the
  // text of width (it's still a big, easily-scanned code with its quiet zone).
  const maxBox = Math.min(zoneH - downShift - Math.round((tiny ? 0 : 1) * dp), Math.floor(Wd * 0.5), Math.round(28 * dp));
  const modDots = opts.qrMM != null
    ? Math.max(2, Math.floor((opts.qrMM * dp) / qrTotal))
    : Math.max(2, Math.floor(maxBox / qrTotal));
  const qrPx = qrTotal * modDots; // full QR box (black symbol + quiet zone)
  let qrY = top + downShift + Math.max(0, Math.round(((zoneH - downShift) - qrPx) / 2));
  if (qrY + qrPx > bottom) qrY = bottom - qrPx; // clamp above the band
  if (qrY < top) qrY = top;
  const textX = qrX + qrPx + Math.round(2 * dp); // quiet zone already inside the box
  const textW = Math.max(4 * dp, Wd - textX - pad);

  // Fonts scale with height (with a "large" bump). 85×55 & 95×70 = big,
  // 70×40 = medium (was tiny), 50×30 = small. On a 300 dpi head the bitmap fonts
  // are physically ~⅔ the size, so bump each label up a tier to compensate.
  const big = h >= (hires ? 44 : 54) || (!!opts.large && h >= 40);
  const med = h >= (hires ? 30 : 38) || (!!opts.large && h >= 26);
  const skuF = big ? "5" : med ? "4" : "3";
  const qtyF = big ? "4" : med ? "3" : "2";

  const qtyStr = l.type === "master" ? `QTY:${l.masterQty} ${l.unit}` : `Qty.${l.singleQty || 1} ${l.unit}`;
  const mrpStr = `MRP.Rs.${Math.round(l.price)}/-`;
  // Show the FULL product name: pick the biggest font at which the whole name
  // fits the allowed line count (3 lines on big labels, 2 otherwise) — instead of
  // silently dropping words like "SPL".
  const maxNameLines = big ? 3 : 2;
  const nameFonts = big ? ["5", "4", "3"] : med ? ["4", "3", "2"] : ["3", "2"];
  let nameF = nameFonts[nameFonts.length - 1];
  let nameLines = wrapAll(esc(l.name), nameF, textW);
  for (const f of nameFonts) {
    const lines = wrapAll(esc(l.name), f, textW);
    if (lines.length <= maxNameLines) { nameF = f; nameLines = lines; break; }
  }
  nameLines = nameLines.slice(0, maxNameLines);
  // If it still overflows the zone height, drop trailing lines (last resort).
  const heightOf = (nl: number) => lh(skuF) + nl * lh(nameF) + 2 * lh(qtyF);
  while (nameLines.length > 1 && heightOf(nameLines.length) > zoneH) nameLines = nameLines.slice(0, -1);

  // Extra attributes (like the reference labels): "(Incl. of All Taxes)", Lot,
  // Rack, PKD — appended below MRP at a small font. Only as many as fit the zone,
  // so big labels carry them all and small labels stay minimal.
  const exF = big ? "3" : "2";
  const allExtras: string[] = ["(Incl. of All Taxes)"];
  if (l.lot) allExtras.push(`Lot: ${l.lot}`);
  if (l.rack) allExtras.push(`Rack: ${l.rack}`);
  if (l.pkd) allExtras.push(`PKD: ${l.pkd}`);
  const baseH = heightOf(nameLines.length);
  let nEx = 0;
  // leave ~3mm breathing room so the block never fills to the top/bottom edges
  while (nEx < allExtras.length && baseH + (nEx + 1) * lh(exF) <= zoneH - Math.round(3 * dp)) nEx++;
  const extras = allExtras.slice(0, nEx);

  // Centre the whole block (text + extras) against the QR, then clamp to the zone.
  const contentH = baseH + extras.length * lh(exF);
  let cy = qrY + Math.max(0, Math.round((qrPx - contentH) / 2));
  if (cy + contentH > bottom) cy = bottom - contentH;
  if (cy < top) cy = top;

  const rows: string[] = [];
  rows.push(`TEXT ${textX},${cy},"${skuF}",0,1,1,"${fitText(esc(l.sku_code), skuF, textW)}"`); cy += lh(skuF);
  for (const nl of nameLines) { rows.push(`TEXT ${textX},${cy},"${nameF}",0,1,1,"${nl}"`); cy += lh(nameF); }
  // QTY and MRP on SEPARATE lines — combined they overran the width and the MRP
  // got cut to "MRP.R." on the bigger labels. Each short line fits fully.
  rows.push(`TEXT ${textX},${cy},"${qtyF}",0,1,1,"${fitText(esc(qtyStr), qtyF, textW)}"`); cy += lh(qtyF);
  rows.push(`TEXT ${textX},${cy},"${qtyF}",0,1,1,"${fitText(esc(mrpStr), qtyF, textW)}"`); cy += lh(qtyF);
  for (const e of extras) { rows.push(`TEXT ${textX},${cy},"${exF}",0,1,1,"${fitText(esc(e), exF, textW)}"`); cy += lh(exF); }

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
    buf.push(Buffer.from(`BITMAP ${qrX + xOff},${qrY},${bmp.widthBytes},${bmp.sideDots},0,`, "ascii"));
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
