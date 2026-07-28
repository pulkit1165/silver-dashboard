import "server-only";
import { getRawSql } from "./db";

// Read-only Oracle-sourced master files (from the oracle_raw mirror — always
// available on Neon, no dependency on the live connector tunnel).

export type WeightRow = {
  code: string; name: string; category: string; weight: number | null;
  stdpack: string; unit: string; vehicle: string; hsn: string; mrp: number | null;
};

const t = (v: unknown) => String(v ?? "");
const numOrNull = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Product weight master — A_LABELPRINT.NETWEIGHT, one (latest) row per item.
export async function getWeightMaster(search?: string, cap = 800): Promise<WeightRow[]> {
  try {
    const sql = getRawSql();
    const like = search && search.trim() ? `%${search.trim()}%` : null;
    const rows = await sql<Record<string, string>[]>`
      SELECT DISTINCT ON (data->>'ITEMCODE')
        data->>'ITEMCODE'  AS code,
        data->>'ITEMDESC'  AS name,
        COALESCE(data->>'ITEMCATEG','') AS category,
        CASE WHEN data->>'NETWEIGHT' ~ '^[0-9.]+$' THEN data->>'NETWEIGHT' ELSE NULL END AS weight,
        COALESCE(data->>'STDPACK','')  AS stdpack,
        COALESCE(data->>'UNITCODE','') AS unit,
        COALESCE(data->>'VEHICLETYPE','') AS vehicle,
        COALESCE(data->>'HSNCODE','')  AS hsn,
        CASE WHEN data->>'MRP' ~ '^[0-9.]+$' THEN data->>'MRP' ELSE NULL END AS mrp
      FROM oracle_raw
      WHERE source_table = 'A_LABELPRINT'
        AND (${like}::text IS NULL OR data->>'ITEMCODE' ILIKE ${like} OR data->>'ITEMDESC' ILIKE ${like})
      ORDER BY data->>'ITEMCODE', (data->>'RN')::numeric DESC NULLS LAST
      LIMIT ${cap}
    `;
    return rows.map((r) => ({
      code: t(r.code), name: t(r.name), category: t(r.category),
      weight: numOrNull(r.weight), stdpack: t(r.stdpack), unit: t(r.unit),
      vehicle: t(r.vehicle), hsn: t(r.hsn), mrp: numOrNull(r.mrp),
    }));
  } catch { return []; }
}

/** Weight per item code (for wiring into packing / dispatch later). */
export async function getWeightByCode(): Promise<Map<string, number>> {
  const rows = await getWeightMaster(undefined, 20000);
  const m = new Map<string, number>();
  for (const r of rows) if (r.weight != null) m.set(r.code.toUpperCase(), r.weight);
  return m;
}
