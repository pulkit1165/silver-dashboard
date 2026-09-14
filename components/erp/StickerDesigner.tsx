"use client";
import LabelDesigner, { type PaletteItem } from "./LabelDesigner";
import { STICKER_SIZES } from "@/lib/erp/stickerSizes";
import { STICKER_SAMPLE_FILL, defaultAbbrevDoc, type LabelFill } from "@/lib/erp/labelDoc";

// The abbreviation-sticker field palette — Line 1 / Line 2 come from the sticker
// master; everything else is the usual QR-label field set (minus header/name).
const STICKER_PALETTE: PaletteItem[] = [
  { kind: "text", field: "abbr1", label: "＋ Line 1 (trade name)" },
  { kind: "text", field: "abbr2", label: "＋ Line 2 (size/variant)" },
  { kind: "text", field: "mrp", label: "＋ MRP" },
  { kind: "text", field: "incltax", label: "＋ incl. tax" },
  { kind: "text", field: "qty", label: "＋ Qty (unit from sheet)" },
  { kind: "text", field: "lot", label: "＋ Lot no" },
  { kind: "text", field: "rack", label: "＋ Rack no" },
  { kind: "text", field: "pkd", label: "＋ PKD date" },
  { kind: "text", field: "code", label: "＋ SKU code" },
  { kind: "text", field: "address", label: "＋ Address block" },
  { kind: "text", field: "custom", label: "＋ Free text" },
  { kind: "qr", label: "＋ QR code" },
  { kind: "line", label: "＋ Line" },
  { kind: "box", label: "＋ Box" },
];

async function enrichFill(code: string): Promise<Partial<LabelFill>> {
  try {
    const r = await fetch(`/api/erp/labels/abbrev?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const d = await r.json();
    if (!d.ok || !d.found) return {};
    return { abbr1: d.abbr1, abbr2: d.abbr2, unit: d.unit, singleQty: d.singleQty, masterQty: d.masterQty };
  } catch { return {}; }
}

export default function StickerDesigner() {
  return (
    <LabelDesigner
      sizes={STICKER_SIZES}
      palette={STICKER_PALETTE}
      sampleFill={STICKER_SAMPLE_FILL}
      makeDefaultDoc={defaultAbbrevDoc}
      enrichFill={enrichFill}
    />
  );
}
