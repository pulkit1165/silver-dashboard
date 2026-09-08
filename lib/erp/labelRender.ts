// ── Shared label renderer (browser canvas) ─────────────────────────────────
// ONE renderer draws both the on-screen editor preview and the exact bitmap that
// is sent to the thermal printer, so "what you see is what prints". Positions are
// in mm; `dp` is dots-per-mm (8 @203dpi, ~11.81 @300dpi on screen we pass a screen
// scale instead). Runs in the browser only (needs <canvas>/Image).

import type { LabelDoc, DesignEl, LabelFill } from "./labelDoc";
import { fieldText } from "./labelDoc";

// Draw the full design onto a canvas context already sized to doc.w*dp × doc.h*dp.
// Async because QR/vector images must load before they can be drawn.
export async function renderDoc(
  ctx: CanvasRenderingContext2D, doc: LabelDoc, fill: LabelFill, dp: number,
): Promise<void> {
  const W = Math.round(doc.w * dp), H = Math.round(doc.h * dp);
  ctx.save();
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#000";
  // When the category (header) line is hidden/empty for this SKU (a suppressed
  // header like MISC / FOOT REST ASSLY, or simply no header), give its row to the
  // NAME so the product name prints BIGGER — it grows up into the freed space and
  // auto-fits. Long names still fit (fit clamps to the taller box).
  let elements = doc.elements;
  const hdrEl = elements.find((e) => e.field === "header");
  if (hdrEl && !fieldText(hdrEl, fill).trim()) {
    const nmEl = elements.find((e) => e.field === "name");
    if (nmEl) {
      const top = Math.min(hdrEl.y, nmEl.y);
      const bottom = nmEl.y + (nmEl.h || 0);
      const grown: DesignEl = {
        ...nmEl, y: top, h: Math.max(bottom - top, nmEl.h || 0),
        fit: true, sizeMM: (nmEl.sizeMM ?? 3) * 2,
      };
      elements = elements.map((e) => (e === nmEl ? grown : e)).filter((e) => e !== hdrEl);
    }
  }

  // Draw QR/barcode LAST (on top) so a line or box placed over them can never
  // corrupt the code — the QR always stays clean and scannable. (stable sort)
  const ordered = [...elements].sort((a, b) =>
    ((a.kind === "qr" || a.kind === "barcode") ? 1 : 0) - ((b.kind === "qr" || b.kind === "barcode") ? 1 : 0));
  for (const el of ordered) {
    ctx.save();
    // Rotate about the element's CENTRE so it turns in place — the box stays where
    // you positioned it (e.g. a 90° vertical caption sits right where you drop it,
    // beside the barcode) instead of swinging off its top-left corner. Must match
    // the on-screen overlay's transformOrigin:"center" in LabelDesigner.
    if (el.rot) {
      const cx = (el.x + el.w / 2) * dp, cy = (el.y + (el.h || 0) / 2) * dp;
      ctx.translate(cx, cy); ctx.rotate((el.rot * Math.PI) / 180); ctx.translate(-cx, -cy);
    }
    try {
      if (el.kind === "text") drawText(ctx, el, fill, dp);
      else if (el.kind === "qr") await drawQr(ctx, el, fill, dp);
      else if (el.kind === "barcode") drawBarcode(ctx, el, fill, dp);
      else if (el.kind === "box") drawBox(ctx, el, dp);
      else if (el.kind === "line") drawLine(ctx, el, dp);
    } catch { /* never let one element break the whole label */ }
    ctx.restore();
  }
  ctx.restore();
}

// Force every font used in a design to finish downloading before we render/print,
// so the print image never falls back to a different face (which would make labels
// differ between PCs). Safe no-op outside the browser.
export async function ensureFontsLoaded(doc: LabelDoc): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const fams = new Set<string>();
  for (const el of doc.elements) if (el.kind === "text" && el.font) fams.add(el.font);
  await Promise.all([...fams].flatMap((f) => [
    document.fonts.load(`400 16px "${f}"`).catch(() => {}),
    document.fonts.load(`700 16px "${f}"`).catch(() => {}),
  ]));
  await document.fonts.ready.catch(() => {});
}

// Word-wrap text to a box width (in px), splitting long words if needed.
export function wrapText(ctx: CanvasRenderingContext2D, raw: string, boxW: number): string[] {
  const lines: string[] = [];
  for (const para of raw.split("\n")) {
    const words = para.split(/\s+/); let cur = "";
    for (let wd of words) {
      // hard-break a single word that is wider than the box
      while (ctx.measureText(wd).width > boxW && wd.length > 1) {
        let cut = wd.length;
        while (cut > 1 && ctx.measureText(wd.slice(0, cut)).width > boxW) cut--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(wd.slice(0, cut)); wd = wd.slice(cut);
      }
      const test = cur ? cur + " " + wd : wd;
      if (ctx.measureText(test).width > boxW && cur) { lines.push(cur); cur = wd; }
      else cur = test;
    }
    lines.push(cur);
  }
  return lines;
}

// Number of lines a text element wraps to, and the mm height it occupies — used
// by the editor to keep boxes from overlapping and to grow the selection frame.
let measureCv: HTMLCanvasElement | null = null;
export function textBoxHeightMM(el: DesignEl, raw: string): number {
  const lhMM = (el.sizeMM ?? 3) * 1.33 * (el.lineh ?? 1.15);
  if (!raw) return lhMM;
  if (!measureCv) measureCv = document.createElement("canvas");
  const ctx = measureCv.getContext("2d")!;
  const DP = 10;
  ctx.font = `${el.italic ? "italic " : ""}${el.bold ? "700 " : "400 "}${(el.sizeMM ?? 3) * DP * 1.33}px "${el.font || "Arial"}", sans-serif`;
  return Math.max(1, wrapText(ctx, raw, el.w * DP).length) * lhMM;
}

function drawText(ctx: CanvasRenderingContext2D, el: DesignEl, fill: LabelFill, dp: number) {
  const raw = fieldText(el, fill);
  if (!raw) return;
  ctx.textBaseline = "top";
  const boxX = el.x * dp, boxY = el.y * dp, boxW = el.w * dp;
  const setFont = (mm: number) => { ctx.font = `${el.italic ? "italic " : ""}${el.bold ? "700 " : "400 "}${Math.max(4, mm * dp * 1.33)}px "${el.font || "Arial"}", sans-serif`; };
  const lh = (mm: number) => mm * dp * 1.33 * (el.lineh ?? 1.15);
  // The NAME always auto-fits (it's the field with wildly varying length); other
  // fields auto-fit only if the operator turned it on. AUTO-FIT shrinks the font
  // until the wrapped text fits the box height, so a long name can never overflow
  // its box and overprint the QR / MRP / address. Never grows past the chosen size.
  const doFit = el.fit === true || el.field === "name";
  let sMM = el.sizeMM ?? 3;
  if (doFit && (el.h || 0) > 0) {
    for (; sMM > 1.2; sMM -= 0.1) {
      setFont(sMM);
      if (wrapText(ctx, raw, boxW).length * lh(sMM) <= el.h * dp + 0.5) break;
    }
  }
  setFont(sMM);
  const lineH = lh(sMM);
  const lines = wrapText(ctx, raw, boxW);
  const boxH = doFit ? el.h * dp : Math.max((el.h || 0) * dp, lineH * lines.length);
  // CLIP to the element's box so text never spills into its neighbours or off-label.
  ctx.save();
  ctx.beginPath(); ctx.rect(boxX, boxY, boxW, boxH); ctx.clip();
  if (el.invert) { ctx.fillStyle = "#000"; ctx.fillRect(boxX, boxY, boxW, boxH); ctx.fillStyle = "#fff"; }
  else ctx.fillStyle = "#000";
  ctx.textAlign = el.align || "left";
  const tx = el.align === "center" ? boxX + boxW / 2 : el.align === "right" ? boxX + boxW : boxX;
  lines.forEach((ln, i) => ctx.fillText(ln, tx, boxY + i * lineH));
  ctx.restore();
  ctx.fillStyle = "#000";
}

// simple in-memory cache of decoded SVG QR images (keyed by svg markup)
const qrImgCache = new Map<string, HTMLImageElement>();
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
}
async function drawQr(ctx: CanvasRenderingContext2D, el: DesignEl, fill: LabelFill, dp: number) {
  const box = Math.min(el.w, el.h) * dp;
  const x = el.x * dp, y = el.y * dp;
  // PREFERRED: draw the module matrix directly as UNIFORM integer-dot squares with a
  // 4-module quiet zone. This is the only way a printed QR scans reliably (a scaled
  // image gives uneven modules). Matches the proven buildTSPL QR-bitmap method.
  const m = fill.qrMatrix;
  if (m && m.size > 0 && m.data?.length === m.size * m.size) {
    const quiet = 4, total = m.size + quiet * 2;
    const modDots = Math.max(1, Math.floor(box / total)); // integer dots per module
    const qpx = total * modDots;
    ctx.fillStyle = "#fff"; ctx.fillRect(x, y, qpx, qpx); // quiet zone (white)
    ctx.fillStyle = "#000";
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
      if (m.data[r * m.size + c]) ctx.fillRect(x + (c + quiet) * modDots, y + (r + quiet) * modDots, modDots, modDots);
    }
    return;
  }
  const svg = fill.qrSvg;
  if (svg) {
    // base64 (with proper UTF-8) is the reliable way to load an SVG into an <img>;
    // the old ";utf8," data-URL silently failed to load in Chrome → no QR printed.
    let img = qrImgCache.get(svg);
    if (!img) {
      const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(svg))) : "";
      img = await loadImg("data:image/svg+xml;base64," + b64);
      qrImgCache.set(svg, img);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, box, box);
  } else {
    // placeholder checker ONLY in the editor when no SKU is loaded (never at print).
    ctx.strokeStyle = "#000"; ctx.strokeRect(x, y, box, box);
    const n = 6, c = box / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) ctx.fillRect(x + i * c, y + j * c, c, c);
  }
}

function drawBox(ctx: CanvasRenderingContext2D, el: DesignEl, dp: number) {
  const x = el.x * dp, y = el.y * dp, w = el.w * dp, h = el.h * dp;
  if (el.fill) ctx.fillRect(x, y, w, h);
  else { ctx.lineWidth = Math.max(1, (el.strokeMM ?? 0.4) * dp); ctx.strokeRect(x, y, w, h); }
}
function drawLine(ctx: CanvasRenderingContext2D, el: DesignEl, dp: number) {
  const x = el.x * dp, y = el.y * dp;
  ctx.lineWidth = Math.max(1, (el.strokeMM ?? 0.3) * dp);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + el.w * dp, y + el.h * dp); ctx.stroke();
}

// ── Code 128-B barcode ──────────────────────────────────────────────────────
const C128: string[] = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
export function drawCode128(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  const clean = (text || "").replace(/[^\x20-\x7f]/g, "").slice(0, 40) || " ";
  const codes = [104]; // Start B
  let sum = 104;
  for (let i = 0; i < clean.length; i++) { const v = clean.charCodeAt(i) - 32; codes.push(v); sum += v * (i + 1); }
  codes.push(sum % 103); // checksum
  codes.push(106);        // Stop
  const patterns = codes.map((c) => C128[c]);
  const totalUnits = patterns.reduce((s, p) => s + p.split("").reduce((a, d) => a + Number(d), 0), 0);
  const unit = w / totalUnits;
  let cx = x; ctx.fillStyle = "#000";
  for (const p of patterns) {
    for (let i = 0; i < p.length; i++) {
      const ww = Number(p[i]) * unit;
      if (i % 2 === 0) ctx.fillRect(cx, y, ww, h); // even index = bar
      cx += ww;
    }
  }
}
function drawBarcode(ctx: CanvasRenderingContext2D, el: DesignEl, fill: LabelFill, dp: number) {
  const text = el.field && el.field !== "custom" ? fieldText(el, fill) : (el.text || fill.sku_code || "");
  drawCode128(ctx, text, el.x * dp, el.y * dp, el.w * dp, el.h * dp);
}

// ── Canvas → TSPL 1-bit bitmap ──────────────────────────────────────────────
// TSPL BITMAP: 1 bit/dot, MSB-first, rows padded to whole bytes, bit 0 = BLACK.
export function packToTSPL(canvas: HTMLCanvasElement): { widthBytes: number; heightDots: number; bytesB64: string } {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, W, H);
  const widthBytes = Math.ceil(W / 8);
  const bytes = new Uint8Array(widthBytes * H).fill(0xff); // all white
  for (let yy = 0; yy < H; yy++) {
    const row = yy * widthBytes;
    for (let xx = 0; xx < W; xx++) {
      const p = (yy * W + xx) * 4;
      const a = data[p + 3];
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      // Threshold biased toward black (176, not 128) so anti-aliased text edges print
      // as SOLID strokes instead of thin/faded ones. QR is drawn with hard-edged
      // integer squares (pure black/white), so this doesn't affect it.
      if (a > 24 && lum < 176) bytes[row + (xx >> 3)] &= ~(0x80 >> (xx & 7)); // black → clear bit
    }
  }
  // base64 (browser-safe)
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { widthBytes, heightDots: H, bytesB64: btoa(bin) };
}

// Render a doc to an OFFSCREEN canvas at printer resolution and pack it for TSPL.
export async function renderDocToTSPL(doc: LabelDoc, fill: LabelFill, dp: number) {
  const cv = document.createElement("canvas");
  cv.width = Math.round(doc.w * dp); cv.height = Math.round(doc.h * dp);
  const ctx = cv.getContext("2d")!;
  await renderDoc(ctx, doc, fill, dp);
  return packToTSPL(cv);
}
