// Backfills master_qty / single_qty on existing SKUs from the legacy Oracle
// item master (SILVER_MASTER.DTA05). STDPACK = master carton pack qty,
// STDPACK2 = single/inner-pack qty (not always 1 — see lib/erp/skuImport.ts).
// READ-ONLY against Oracle, via the same remote connector the dashboard uses.
// Update-only: never creates SKUs, matched by sku_code. Idempotent.
//
// Usage: node scripts/import-oracle-pack-sizes.mjs
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const REMOTE = process.env.REMOTE_DATA_URL;
const DB_URL = process.env.DATABASE_URL;
if (!REMOTE) { console.error("REMOTE_DATA_URL not set in .env.local"); process.exit(1); }
if (!DB_URL) { console.error("DATABASE_URL not set in .env.local"); process.exit(1); }

async function oraQuery(sql) {
  const res = await fetch(`${REMOTE.replace(/\/$/, "")}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "1", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || `Oracle query failed (${res.status})`);
  return body.rows;
}

const sqlpg = postgres(DB_URL, { prepare: false });

async function run() {
  const existing = new Set((await sqlpg`SELECT sku_code FROM skus`).map((r) => r.sku_code));
  console.log(`${existing.size} SKUs in Postgres.`);

  const batchSize = 400;
  let start = 1, total = 0, updated = 0, skipped = 0, unchanged = 0;
  for (;;) {
    const end = start + batchSize - 1;
    const oraRows = await oraQuery(`
      select * from (
        select itemcode, stdpack, stdpack2, row_number() over (order by itemcode) rn
          from SILVER_MASTER.DTA05
         where status = 'ACTIVE' and activestatus = 'ACTIVE'
      ) where rn between ${start} and ${end}`);
    if (oraRows.length === 0) break;
    total += oraRows.length;

    const rows = [];
    for (const r of oraRows) {
      const code = String(r.ITEMCODE || "").trim().toUpperCase();
      if (!code || !existing.has(code)) { skipped++; continue; }
      const masterQty = Number(r.STDPACK) || 0;
      const singleQty = Number(r.STDPACK2) > 0 ? Number(r.STDPACK2) : 1;
      rows.push([code, masterQty, singleQty]);
    }

    if (rows.length > 0) {
      const result = await sqlpg`
        UPDATE skus AS s SET master_qty = v.master_qty::float8, single_qty = v.single_qty::float8
        FROM (VALUES ${sqlpg(rows)}) AS v(sku_code, master_qty, single_qty)
        WHERE s.sku_code = v.sku_code
          AND (s.master_qty IS DISTINCT FROM v.master_qty::float8 OR s.single_qty IS DISTINCT FROM v.single_qty::float8)
        RETURNING s.sku_code`;
      updated += result.length;
      unchanged += rows.length - result.length;
    }
    console.log(`  ...batch ${start}-${end}: ${oraRows.length} read — running total ${updated} updated, ${unchanged} unchanged, ${skipped} skipped`);

    if (oraRows.length < batchSize) break;
    start += batchSize;
  }
  console.log(`Done. ${total} processed: ${updated} updated, ${unchanged} already matched, ${skipped} not in Postgres.`);
}

await run();
await sqlpg.end();
