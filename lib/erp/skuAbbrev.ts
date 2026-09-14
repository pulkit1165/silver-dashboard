import "server-only";
import { getSql } from "./db";

// Abbreviation / "trade name" sticker master — a SEPARATE per-SKU table for the
// parallel abbreviation-sticker module. It is NOT label_master (which drives the
// current QR stickers) and does NOT touch skus.name / the MRP master. Sourced from
// the client's "ITEMS MASTER.xlsx": line1 = Label Desc., line2 = Label Desc.1,
// unit = Units, master_pack = MASTER PACK, single_pack = SINGAL PACK.

export type AbbrevRow = {
  line1: string; line2: string; unit: string;
  masterPack: number; singlePack: number;
};

// `id serial` + `sku_code UNIQUE` are required so the shared master-import handleRow
// (SELECT id, sku_code … ; UPDATE … WHERE id=…) works against this table.
let ensured: Promise<void> | null = null;
export function ensureAbbrevTable(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS sku_abbrev_master (
        id serial PRIMARY KEY,
        sku_code text UNIQUE NOT NULL,
        line1 text DEFAULT '',
        line2 text DEFAULT '',
        unit text DEFAULT '',
        master_pack integer DEFAULT 0,
        single_pack integer DEFAULT 0,
        updated_by text,
        updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const s = (v: unknown, max = 60) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const n = (v: unknown) => Math.max(0, Math.min(9999999, Math.round(Number(v) || 0)));

export async function getAbbrevMasters(): Promise<Record<string, AbbrevRow>> {
  try {
    await ensureAbbrevTable();
    const rows = (await getSql()`SELECT sku_code, line1, line2, unit, COALESCE(master_pack,0) AS master_pack, COALESCE(single_pack,0) AS single_pack FROM sku_abbrev_master`) as unknown as
      Array<{ sku_code: string; line1: string; line2: string; unit: string; master_pack: number; single_pack: number }>;
    const out: Record<string, AbbrevRow> = {};
    for (const r of rows) out[String(r.sku_code).toUpperCase()] = {
      line1: r.line1 || "", line2: r.line2 || "", unit: r.unit || "",
      masterPack: Number(r.master_pack) || 0, singlePack: Number(r.single_pack) || 0,
    };
    return out;
  } catch { return {}; }
}

export async function getAbbrevMaster(code: string): Promise<AbbrevRow | null> {
  try {
    await ensureAbbrevTable();
    const [r] = (await getSql()`SELECT line1, line2, unit, COALESCE(master_pack,0) AS master_pack, COALESCE(single_pack,0) AS single_pack FROM sku_abbrev_master WHERE sku_code=${String(code).trim().toUpperCase()}`) as unknown as
      Array<{ line1: string; line2: string; unit: string; master_pack: number; single_pack: number }>;
    if (!r) return null;
    return { line1: r.line1 || "", line2: r.line2 || "", unit: r.unit || "", masterPack: Number(r.master_pack) || 0, singlePack: Number(r.single_pack) || 0 };
  } catch { return null; }
}

export async function saveAbbrevMaster(skuCode: string, r: Partial<AbbrevRow>, actor?: string | null): Promise<void> {
  await ensureAbbrevTable();
  const code = String(skuCode).trim().toUpperCase();
  const line1 = s(r.line1), line2 = s(r.line2), unit = s(r.unit, 12);
  const masterPack = n(r.masterPack), singlePack = n(r.singlePack);
  await getSql()`
    INSERT INTO sku_abbrev_master (sku_code, line1, line2, unit, master_pack, single_pack, updated_by, updated_at)
    VALUES (${code}, ${line1}, ${line2}, ${unit}, ${masterPack}, ${singlePack}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (sku_code) DO UPDATE SET line1=${line1}, line2=${line2}, unit=${unit},
      master_pack=${masterPack}, single_pack=${singlePack}, updated_by=${actor ?? null},
      updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}
