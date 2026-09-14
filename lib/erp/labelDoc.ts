// ── Label design document (the "Photoshop file" for a label) ────────────────
// A design is a list of freely-placed elements on a canvas the exact physical
// size of the label (mm). It is RESOLUTION-INDEPENDENT: every position/size is in
// millimetres, so the same doc renders identically at 203 or 300 dpi and on screen.
// The SAME renderer (lib/erp/labelRender.ts) draws the on-screen preview AND the
// bitmap that is sent to the printer — so what you see is exactly what prints.
//
// This module is pure data + formatting (no browser, no DB) so it can be imported
// from the client editor, the renderer, and the server.

export type ElField =
  | "code" | "name" | "header" | "mrp" | "qty" | "lot" | "rack" | "pkd"
  | "incltax" | "custom" | "address"
  // Abbreviation-sticker fields (separate module): abbr1 = trade/abbrev name line,
  // abbr2 = variant/size line. Only used by sticker designs; current labels ignore them.
  | "abbr1" | "abbr2";

export type ElKind = "text" | "qr" | "barcode" | "box" | "line";

export type DesignEl = {
  id: string;
  kind: ElKind;
  // text elements bind to a data field (or are static custom/address text)
  field?: ElField;
  text?: string;            // literal text for custom/address (and multi-line via \n)
  // geometry — millimetres, top-left origin
  x: number; y: number; w: number; h: number;
  rot?: 0 | 90 | 180 | 270; // rotation
  // text styling
  font?: string;            // css font-family
  sizeMM?: number;          // font size (cap height) in mm — dpi-independent
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  lineh?: number;           // line-height multiplier (default 1.15)
  fit?: boolean;            // AUTO-FIT: shrink the font so any-length text fits the box
  invert?: boolean;         // white text on black (for a black bar)
  // box / line styling
  strokeMM?: number;        // line/box border thickness in mm
  fill?: boolean;           // filled box (black)
};

export type LabelDoc = {
  version: 1;
  w: number;                // mm
  h: number;                // mm
  elements: DesignEl[];
};

// The data a label is filled with at render time (matches the print payload).
export type LabelFill = {
  sku_code?: string; name?: string; header?: string; price?: number;
  unit?: string; singleQty?: number; masterQty?: number; tier?: "single" | "master";
  lot?: string; rack?: string; pkd?: string;
  qrSvg?: string;           // the real QR (SVG markup) for this SKU's token
  qrMatrix?: { size: number; data: number[] }; // raw module matrix (preferred — scannable)
  address?: string;         // company address block (from settings / doc)
  abbr1?: string;           // sticker module: trade/abbrev name line (Label Desc.)
  abbr2?: string;           // sticker module: variant/size line (Label Desc.1)
};

// Format a bound field into the exact text that prints. Prefixes match the
// current labels (MRP.Rs. / Qty. / Lot: / Rack: / PKD:). "custom"/"address" use
// the element's own text.
// Normalise a packed date to DD-MM-YYYY (e.g. "01-Sep-2026" → "01-09-2026").
const _MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function fmtPkd(s: string): string {
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/);
  if (m) { const mm = _MON[m[2].slice(0, 3).toLowerCase()] ?? m[2]; return `${m[1].padStart(2, "0")}-${mm}-${m[3]}`; }
  return s; // already numeric / unknown → leave as-is
}

// Headers that are NOT a real part type (a catch-all bucket, or one that just
// repeats the product name) — for these the label prints only the full product
// name, never the header line. Compared with spacing/punctuation ignored.
const SUPPRESSED_HEADERS = new Set([
  "MISC", "MISCITEMS", "MISCELLANEOUS", "MISCELLANEOUSITEMS",
  "HANDLEGRIPSETOF3",     // "HANDLE GRIP (SET OF 3)"
  "FOOTRESTASSLYREAR",    // "FOOT REST ASSLY. REAR"  (names use "RR FT REST ASLY …")
  "FOOTRESTASSLYFRONT",   // "FOOT REST ASSLY. FRONT" (names use "FR FT REST ASLY …")
  "HEADLIGHTVISORPATTISET", // "HEAD LIGHT VISOR PATTI & SET" (SU40035 etc.)
  "BOLTNUTWWASHERGOLDEN",   // "BOLT NUT W/WASHER (GOLDEN)"   (UN00015 etc.)
  "BRAKEDRUMBOLTWNUT",      // "BRAKE DRUM BOLT W/NUT" (KB05096 etc. — 7 SKUs; header says NUT but variants incl. W/PIN, name is self-descriptive)
  "BOLTNUTSINGLEWASHERSILVER", // "BOLT NUT SINGLE WASHER (SILVER)" (UN10035 etc. — 16 SKUs; name already carries "BOLT NUT SINGLE WASHER NO.<size>")
  "NUMBERPLATEBRACKETFRONTREAR", // "NUMBER PLATE BRACKET FRONT/ REAR" (HH54029 etc. — 20 SKUs; names are self-descriptive NUMBER PLATE BRACKET FRONT/REAR <variant>)
  "KITHEADDAWAL",           // "KIT HEAD DAWAL" (SU47030 etc. — 9 SKUs; names are self-descriptive KIT HEAD DAWAL/DAWEL <variant>)
]);
export function isMiscHeader(h: string): boolean {
  return SUPPRESSED_HEADERS.has(String(h ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
}

export function fieldText(el: DesignEl, d: LabelFill): string {
  const money = (n: unknown) => {
    const r = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2);
  };
  switch (el.field) {
    case "code": return String(d.sku_code ?? "");
    // Header (part type) and Name (variant) are SEPARATE fields so their sizes can be
    // set independently. `header` = the price-list category; `name` = the specific
    // variant with the header prefix stripped (falls back to the full name).
    case "header": {
      const h = String(d.header ?? "").trim();
      // "MISC . ITEMS" is a catch-all bucket, not a real part type — never print it
      // as the header line; the product name (below) carries the meaning.
      return isMiscHeader(h) ? "" : h;
    }
    case "name": {
      const full = String(d.name ?? "");
      const hdr = String(d.header ?? "").trim();
      // A misc/blank header is not a real prefix, so show the FULL product name.
      if (!hdr || isMiscHeader(hdr)) return full;
      return full.toUpperCase().startsWith(hdr.toUpperCase())
        ? full.slice(hdr.length).replace(/^[\s\-/]+/, "").trim() : full;
    }
    case "mrp": return d.price != null ? `MRP.Rs.${money(d.price)}/-` : "";
    // Abbreviation-sticker lines — printed verbatim from the sticker master.
    case "abbr1": return String(d.abbr1 ?? "");
    case "abbr2": return String(d.abbr2 ?? "");
    // The "inclusive of taxes" note — a fixed caption the operator places under MRP.
    case "incltax": return "incl. tax";
    case "qty": {
      // Master label shows the CARTON qty (masterQty); single shows the piece qty.
      const q = d.tier === "master" ? (d.masterQty ?? d.singleQty ?? 1) : (d.singleQty ?? 1);
      const u = (d.unit ?? "PCS").trim();
      return `Qty. ${q}${u ? " " + u : ""}`;
    }
    // Lot/Rack: ALWAYS show the label; the number stays blank when the SKU has none.
    case "lot": return `Lot No - ${d.lot ?? ""}`;
    case "rack": return `Rack No - ${d.rack ?? ""}`;
    case "pkd": return `PKD - ${fmtPkd(String(d.pkd ?? ""))}`;
    case "address": return String(el.text ?? d.address ?? "");
    case "custom":
    default: return String(el.text ?? "");
  }
}

// Sample data for the editor preview (so the operator designs against realistic
// content, not empty boxes).
export const SAMPLE_FILL: LabelFill = {
  sku_code: "HH12006", name: "CENTER STAND KIT SPL", header: "CENTER STAND KIT", price: 570,
  unit: "PCS", singleQty: 1, masterQty: 1, lot: "L-2291", rack: "R-14", pkd: "08/26",
  address: "SILVER INDUSTRIES\nPlot 12, Focal Point, Ludhiana 141010\nGSTIN 03ABCDE1234F1Z5",
};

// Preview data for the ABBREVIATION-sticker designer (line1 / line2 come from the
// sticker master; the rest mirrors SAMPLE_FILL so QR/MRP/qty/address render realistically).
export const STICKER_SAMPLE_FILL: LabelFill = {
  ...SAMPLE_FILL,
  sku_code: "UN00815", abbr1: "BOLT NUT W/WASHER", abbr2: "N0. 8*15",
  name: "BOLT NUT W/WASHER N0. 8*15", header: "", price: 3.2, unit: "PC",
  singleQty: 100, masterQty: 200,
};

const uid = () => Math.random().toString(36).slice(2, 9);

// A reasonable STARTING layout for a fresh size (address at the bottom, code +
// name top-left, QR top-right, MRP/qty row). The operator then rearranges freely.
export function defaultDoc(w: number, h: number): LabelDoc {
  const pad = Math.max(1.5, Math.round(w * 0.03));
  const qrSize = Math.min(h * 0.5, 22);
  const rightQrX = w - pad - qrSize;
  const textW = rightQrX - pad - 1;
  const addrH = Math.max(7, h * 0.24);
  return {
    version: 1, w, h,
    elements: [
      { id: uid(), kind: "text", field: "code", text: "", x: pad, y: pad, w: textW, h: 5,
        font: "Arial", sizeMM: 3.6, bold: true, align: "left" },
      { id: uid(), kind: "text", field: "header", x: pad, y: pad + 5.5, w: textW, h: 4.5,
        font: "Arial", sizeMM: 3, bold: true, align: "left", fit: true },
      { id: uid(), kind: "text", field: "name", x: pad, y: pad + 10.5, w: textW, h: 7,
        font: "Arial", sizeMM: 3.2, bold: true, align: "left", lineh: 1.1, fit: true },
      { id: uid(), kind: "qr", x: rightQrX, y: pad, w: qrSize, h: qrSize },
      { id: uid(), kind: "text", field: "mrp", x: pad, y: h - addrH - 5.5, w: textW, h: 4.5,
        font: "Arial", sizeMM: 3.2, bold: true, align: "left" },
      { id: uid(), kind: "text", field: "qty", x: rightQrX, y: h - addrH - 5.5, w: qrSize + pad, h: 4.5,
        font: "Arial", sizeMM: 3, bold: false, align: "right" },
      { id: uid(), kind: "line", x: pad, y: h - addrH - 1, w: w - pad * 2, h: 0, strokeMM: 0.3 },
      { id: uid(), kind: "text", field: "address", x: pad, y: h - addrH, w: w - pad * 2, h: addrH,
        font: "Arial", sizeMM: 2.3, bold: false, align: "left", lineh: 1.15 },
    ],
  };
}

// Starting layout for an ABBREVIATION sticker (the separate module) — modelled on
// the client's green sticker: line 1 (trade name) big, line 2 (variant/size) under
// it, QR top-right, MRP + incl.tax, Qty (with the sheet unit), Lot/Rack, address.
// Keeps the QR (abbreviation stickers are still QR, just different text + layout).
export function defaultAbbrevDoc(w: number, h: number): LabelDoc {
  const pad = Math.max(1.5, Math.round(w * 0.03));
  const qrSize = Math.min(h * 0.5, 22);
  const rightQrX = w - pad - qrSize;
  const textW = rightQrX - pad - 1;
  const addrH = Math.max(7, h * 0.22);
  return {
    version: 1, w, h,
    elements: [
      { id: uid(), kind: "text", field: "abbr1", x: pad, y: pad, w: textW, h: 6,
        font: "Arial", sizeMM: 4.2, bold: true, align: "left", fit: true },
      { id: uid(), kind: "text", field: "abbr2", x: pad, y: pad + 6.5, w: textW, h: 4.5,
        font: "Arial", sizeMM: 3, bold: true, align: "left", fit: true },
      { id: uid(), kind: "qr", x: rightQrX, y: pad, w: qrSize, h: qrSize },
      { id: uid(), kind: "text", field: "mrp", x: pad, y: pad + 12, w: textW * 0.6, h: 5,
        font: "Arial", sizeMM: 3.6, bold: true, align: "left" },
      { id: uid(), kind: "text", field: "incltax", x: pad + textW * 0.6, y: pad + 12.8, w: textW * 0.4, h: 4,
        font: "Arial", sizeMM: 2.3, bold: false, align: "left" },
      { id: uid(), kind: "text", field: "qty", x: pad, y: pad + 17.5, w: textW * 0.55, h: 4.5,
        font: "Arial", sizeMM: 3, bold: true, align: "left" },
      { id: uid(), kind: "text", field: "lot", x: rightQrX, y: pad + qrSize + 0.5, w: qrSize + pad, h: 4,
        font: "Arial", sizeMM: 2.2, bold: false, align: "left" },
      { id: uid(), kind: "text", field: "rack", x: pad, y: pad + 22, w: textW * 0.55, h: 4,
        font: "Arial", sizeMM: 2.2, bold: false, align: "left" },
      { id: uid(), kind: "line", x: pad, y: h - addrH - 1, w: w - pad * 2, h: 0, strokeMM: 0.3 },
      { id: uid(), kind: "text", field: "address", x: pad, y: h - addrH, w: w - pad * 2, h: addrH,
        font: "Arial", sizeMM: 2.2, bold: false, align: "left", lineh: 1.15 },
    ],
  };
}

export function newElement(kind: ElKind, w: number, h: number): DesignEl {
  const cx = w / 2, cy = h / 2;
  const base = { id: uid(), kind, x: Math.max(0, cx - 15), y: Math.max(0, cy - 3), rot: 0 as const };
  if (kind === "qr") return { ...base, w: 18, h: 18 };
  if (kind === "barcode") return { ...base, w: 34, h: 10, field: "code" };
  if (kind === "box") return { ...base, w: 24, h: 10, strokeMM: 0.4, fill: false };
  if (kind === "line") return { ...base, w: 30, h: 0, strokeMM: 0.3 };
  // text
  return { ...base, w: 34, h: 5, kind: "text", field: "custom", text: "Text",
    font: "Arial", sizeMM: 3, bold: false, align: "left", lineh: 1.15 };
}

// Font families offered in the editor, grouped for the dropdown. The "Web fonts"
// are bundled/loaded by the app (see the <link> on the design page) so a label
// renders IDENTICALLY on every ERP PC regardless of what's installed locally.
// The "System" group are faces present on virtually every machine.
export const FONT_GROUPS: { label: string; fonts: string[] }[] = [
  { label: "Sans (web)", fonts: ["Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Work Sans", "Rubik", "PT Sans", "Barlow", "Archivo"] },
  { label: "Condensed / bold display (web)", fonts: ["Roboto Condensed", "Barlow Condensed", "Archivo Narrow", "Oswald", "Bebas Neue", "Anton"] },
  { label: "Serif (web)", fonts: ["Merriweather", "Roboto Slab", "PT Serif"] },
  { label: "Mono (web)", fonts: ["Roboto Mono", "JetBrains Mono"] },
  { label: "System", fonts: ["Arial", "Arial Narrow", "Verdana", "Tahoma", "Trebuchet MS", "Times New Roman", "Georgia", "Courier New", "Impact"] },
];
export const FONT_FAMILIES = FONT_GROUPS.flatMap((g) => g.fonts);

// Font-size choices (mm cap-height) shown as a dropdown, like a word processor.
export const SIZE_CHOICES_MM = [1.5, 1.8, 2, 2.3, 2.6, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10, 12];
