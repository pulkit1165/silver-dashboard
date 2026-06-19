// Backfill: ensure every SKU has an active qr_codes row mirroring skus.qr_token.
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(url, { prepare: false });

const skus = await sql`SELECT id, sku_code, qr_token FROM skus`;
let made = 0;
for (const s of skus) {
  const [exists] = await sql`SELECT id FROM qr_codes WHERE token=${s.qr_token}`;
  if (!exists) {
    await sql`INSERT INTO qr_codes (sku_id, sku_code, token, status, created_by)
              VALUES (${s.id}, ${s.sku_code}, ${s.qr_token}, 'active', 'backfill')`;
    made++;
  }
}
console.log(`Backfilled ${made} qr_codes row(s) for ${skus.length} SKU(s).`);
await sql.end();
