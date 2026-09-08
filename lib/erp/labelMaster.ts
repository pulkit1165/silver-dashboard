import "server-only";
import { getSql } from "./db";

// Barcode/label master — the structured label text per SKU, modelled on the old
// Item Master's "Label Desc. / Label Desc.1 / Label Desc.2" fields. line1/2/3 are
// the exact name lines that print (in order); units/lot/rack feed the label too.
// This is the source of truth for how a part's label reads; the print path uses it.

export type NameClass = "auto" | "short" | "long";
export type LabelMasterRow = {
  line1: string; line2: string; line3: string;
  units: string; lot: string; rack: string;
  // The per-SKU quantity that prints in the Qty line together with `units`, e.g.
  // units="SET", unitQty=2 → "Qty: 2 SET". Set once per SKU, saved forever. 0 = none.
  unitQty: number;
  // Whether this SKU prints the SHORT-name or LONG-name label design. 'auto' decides
  // by name length; 'short'/'long' force it. Long-name SKUs use the size's `__long`
  // design if one is approved (else they fall back to the normal design).
  nameClass: NameClass;
};

// A name longer than this (characters) defaults to the LONG-name label design.
export const LONG_NAME_CHARS = 24;
export function resolveNameClass(name: string, override?: NameClass | null): "short" | "long" {
  if (override === "short" || override === "long") return override;
  return String(name ?? "").trim().length > LONG_NAME_CHARS ? "long" : "short";
}

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS label_master (
        sku_code text PRIMARY KEY,
        line1 text DEFAULT '', line2 text DEFAULT '', line3 text DEFAULT '',
        units text DEFAULT '', lot text DEFAULT '', rack text DEFAULT '',
        updated_by text,
        updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
      try { await sql`ALTER TABLE label_master ADD COLUMN IF NOT EXISTS unit_qty integer DEFAULT 0`; } catch { /* concurrent/exists */ }
      try { await sql`ALTER TABLE label_master ADD COLUMN IF NOT EXISTS name_class text DEFAULT 'auto'`; } catch { /* concurrent/exists */ }
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const s = (v: unknown, max = 60) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export async function getLabelMasters(): Promise<Record<string, LabelMasterRow>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT sku_code, line1, line2, line3, units, lot, rack, COALESCE(unit_qty,0) AS unit_qty, COALESCE(name_class,'auto') AS name_class FROM label_master`) as unknown as
      ({ sku_code: string; name_class: string } & LabelMasterRow)[];
    const out: Record<string, LabelMasterRow> = {};
    for (const r of rows) out[r.sku_code] = { line1: r.line1 || "", line2: r.line2 || "", line3: r.line3 || "", units: r.units || "", lot: r.lot || "", rack: r.rack || "", unitQty: Number(r.unitQty) || 0, nameClass: (r.name_class === "short" || r.name_class === "long") ? r.name_class : "auto" };
    return out;
  } catch { return {}; }
}

export async function saveLabelMaster(skuCode: string, r: Partial<LabelMasterRow>, actor?: string | null): Promise<void> {
  await ensure();
  const line1 = s(r.line1), line2 = s(r.line2), line3 = s(r.line3);
  const units = s(r.units, 12), lot = s(r.lot, 30), rack = s(r.rack, 30);
  const unitQty = Math.max(0, Math.min(99999, Math.round(Number(r.unitQty) || 0)));
  const nameClass: NameClass = (r.nameClass === "short" || r.nameClass === "long") ? r.nameClass : "auto";
  // If everything is blank (and the class is left on auto), clear the row so the SKU
  // falls back to its real name. A short/long override keeps the row alive.
  if (![line1, line2, line3, units, lot, rack].some(Boolean) && !unitQty && nameClass === "auto") {
    await getSql()`DELETE FROM label_master WHERE sku_code=${skuCode}`;
    return;
  }
  await getSql()`
    INSERT INTO label_master (sku_code, line1, line2, line3, units, lot, rack, unit_qty, name_class, updated_by, updated_at)
    VALUES (${skuCode}, ${line1}, ${line2}, ${line3}, ${units}, ${lot}, ${rack}, ${unitQty}, ${nameClass}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (sku_code) DO UPDATE SET line1=${line1}, line2=${line2}, line3=${line3},
      units=${units}, lot=${lot}, rack=${rack}, unit_qty=${unitQty}, name_class=${nameClass}, updated_by=${actor ?? null},
      updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}
