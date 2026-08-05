import "server-only";
import { getSql } from "./db";

// Barcode/label master — the structured label text per SKU, modelled on the old
// Item Master's "Label Desc. / Label Desc.1 / Label Desc.2" fields. line1/2/3 are
// the exact name lines that print (in order); units/lot/rack feed the label too.
// This is the source of truth for how a part's label reads; the print path uses it.

export type LabelMasterRow = {
  line1: string; line2: string; line3: string;
  units: string; lot: string; rack: string;
};

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
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const s = (v: unknown, max = 60) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export async function getLabelMasters(): Promise<Record<string, LabelMasterRow>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT sku_code, line1, line2, line3, units, lot, rack FROM label_master`) as unknown as
      ({ sku_code: string } & LabelMasterRow)[];
    const out: Record<string, LabelMasterRow> = {};
    for (const r of rows) out[r.sku_code] = { line1: r.line1 || "", line2: r.line2 || "", line3: r.line3 || "", units: r.units || "", lot: r.lot || "", rack: r.rack || "" };
    return out;
  } catch { return {}; }
}

export async function saveLabelMaster(skuCode: string, r: Partial<LabelMasterRow>, actor?: string | null): Promise<void> {
  await ensure();
  const line1 = s(r.line1), line2 = s(r.line2), line3 = s(r.line3);
  const units = s(r.units, 12), lot = s(r.lot, 30), rack = s(r.rack, 30);
  // If everything is blank, clear the row so the SKU falls back to its real name.
  if (![line1, line2, line3, units, lot, rack].some(Boolean)) {
    await getSql()`DELETE FROM label_master WHERE sku_code=${skuCode}`;
    return;
  }
  await getSql()`
    INSERT INTO label_master (sku_code, line1, line2, line3, units, lot, rack, updated_by, updated_at)
    VALUES (${skuCode}, ${line1}, ${line2}, ${line3}, ${units}, ${lot}, ${rack}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (sku_code) DO UPDATE SET line1=${line1}, line2=${line2}, line3=${line3},
      units=${units}, lot=${lot}, rack=${rack}, updated_by=${actor ?? null},
      updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}
