// Import a CODE,NAME,MRP price-list CSV into skus + qr_codes. Idempotent.
// Usage: DATABASE_URL=... node scripts/import-csv.mjs data/silverup-pricelist-full.csv
import postgres from "postgres";
import crypto from "node:crypto";
import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
const file = process.argv[2];
if (!url || !file) { console.error("usage: DATABASE_URL=.. node scripts/import-csv.mjs <file.csv>"); process.exit(1); }
const genToken = (p = "SQR") => `${p}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
const sql = postgres(url, { prepare: false });

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
const start = /item\s*code/i.test(lines[0]) ? 1 : 0;

const existing = new Set(((await sql`SELECT sku_code FROM skus`)).map((r) => r.sku_code.toUpperCase()));
const seen = new Set();
let inserted = 0, skipped = 0;
const errors = [];

for (let i = start; i < lines.length; i++) {
  const parts = lines[i].split(",");
  if (parts.length < 2) { continue; }
  const code = (parts.shift() || "").trim().toUpperCase();
  const mrp = parseFloat((parts.pop() || "").replace(/[^0-9.\-]/g, "")) || 0;
  const name = parts.join(",").trim();
  if (!code || !name) { errors.push(`line ${i + 1}: missing code/name`); skipped++; continue; }
  if (existing.has(code) || seen.has(code)) { skipped++; continue; }
  seen.add(code);
  try {
    const token = genToken();
    const category = name.split(/\s+/)[0].toUpperCase();
    const [s] = await sql`INSERT INTO skus (sku_code,name,category,unit,price,selling_price,qr_token)
                          VALUES (${code},${name},${category},'PCS',${mrp},${mrp},${token}) RETURNING id`;
    await sql`INSERT INTO qr_codes (sku_id,sku_code,token,status,created_by) VALUES (${s.id},${code},${token},'active','import')`;
    inserted++;
  } catch (e) { errors.push(`${code}: ${e.message}`); skipped++; }
}
console.log(`Imported ${inserted}, skipped ${skipped} (dupes/blank). Errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 8).join("\n"));
await sql.end();
