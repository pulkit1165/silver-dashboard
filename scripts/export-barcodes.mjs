// One-off: fetch all SKUs and render a QR PNG per barcode token for the
// printable Excel. Run from the project dir (uses local postgres.js + qrcode).
import postgres from "postgres";
import QRCode from "qrcode";
import fs from "node:fs";

const url = process.env.DATABASE_URL || "postgresql://pulkitsharma@localhost:5432/erp";
const sql = postgres(url, { max: 4 });

const OUT = "/tmp/qr_imgs";
fs.mkdirSync(OUT, { recursive: true });

const rows = await sql`
  SELECT sku_code, name, COALESCE(selling_price, price, 0)::float8 AS mrp, qr_token
  FROM skus ORDER BY name, sku_code`;

let i = 0;
const out = [];
for (const r of rows) {
  const file = `${OUT}/${r.qr_token}.png`;
  // crisp enough to print; Excel will display it smaller
  await QRCode.toFile(file, r.qr_token, { margin: 1, width: 300, errorCorrectionLevel: "M" });
  out.push({ sku_code: r.sku_code, name: r.name, mrp: r.mrp, barcode: r.qr_token, img: file });
  if (++i % 250 === 0) console.log(`  ${i}/${rows.length} QR images…`);
}

fs.writeFileSync("/tmp/sku_rows.json", JSON.stringify(out));
console.log(`Generated ${out.length} QR images → ${OUT}`);
console.log("Wrote /tmp/sku_rows.json");
await sql.end();
