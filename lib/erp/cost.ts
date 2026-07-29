import "server-only";
import { getRawSql } from "./db";

// Current cost price per SKU code — latest A_CURRCPM.RATE per item, mapped to the
// item code via VW_MRPLIST (itemid → itemcode). Read-only from the Oracle mirror.
// This is the unit cost the gross-profit engine uses.
export async function getCostByCode(): Promise<Map<string, number>> {
  try {
    const db = getRawSql();
    const rows = (await db`
      WITH cost AS (
        SELECT DISTINCT ON (data->>'ITEMID') data->>'ITEMID' AS itemid, (data->>'RATE')::numeric AS rate
          FROM oracle_raw
         WHERE source_table = 'A_CURRCPM' AND data->>'RATE' ~ '^[0-9.]+$'
         ORDER BY data->>'ITEMID', (data->>'TRDATE') DESC
      ),
      code AS (
        SELECT DISTINCT ON (data->>'ITEMID') data->>'ITEMID' AS itemid, UPPER(data->>'ITEMCODE') AS code
          FROM oracle_raw
         WHERE source_table = 'VW_MRPLIST'
         ORDER BY data->>'ITEMID', (data->>'TRDATE') DESC
      )
      SELECT c.code, k.rate FROM code c JOIN cost k ON k.itemid = c.itemid WHERE k.rate > 0`) as unknown as { code: string; rate: number }[];
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.code).toUpperCase(), Number(r.rate) || 0);
    return m;
  } catch {
    return new Map();
  }
}
