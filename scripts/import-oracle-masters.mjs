// Import real customers, vendors, and items (with rates) from the legacy
// Oracle ERP into our Postgres ERP. READ-ONLY against Oracle — goes through
// the same remote connector the dashboard uses, which only ever permits a
// single SELECT/WITH per call and runs inside SET TRANSACTION READ ONLY.
// Idempotent: re-running just refreshes existing rows by code, no duplicates.
//
// Usage: node scripts/import-oracle-masters.mjs
import postgres from "postgres";
import crypto from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

const REMOTE = process.env.REMOTE_DATA_URL;
const DB_URL = process.env.DATABASE_URL;
if (!REMOTE) { console.error("REMOTE_DATA_URL not set in .env.local"); process.exit(1); }
if (!DB_URL) { console.error("DATABASE_URL not set in .env.local"); process.exit(1); }

async function oraQuery(sql) {
  const res = await fetch(`${REMOTE.replace(/\/$/, "")}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "1" },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || `Oracle query failed (${res.status})`);
  return body.rows;
}

const sqlpg = postgres(DB_URL, { prepare: false });

function addr(r) {
  return [r.ADD1, r.ADD2, r.ADD3, r.ADD4, r.ADD5].filter(Boolean).join(", ");
}

async function importCustomers() {
  console.log("Fetching customers (real, billed this year) from Oracle...");
  const rows = await oraQuery(`
    select p.acntid, p.acntcode, p.acntdesc, p.gstinno, p.add1, p.add2, p.add3, p.add4, p.add5,
           p.mobile, p.phoneoff, p.email, p.creditdays, p.credit_limit_amount
      from SILVER_MASTER.DTA02 p
     where p.acntid in (select distinct partyid from VW_GST_OUTPUT)
     order by p.acntdesc`);
  console.log(`  ${rows.length} customers found.`);

  let inserted = 0, updated = 0;
  for (const r of rows) {
    const code = String(r.ACNTCODE || `ORA-${r.ACNTID}`).trim();
    const name = String(r.ACNTDESC || "").trim();
    if (!name) continue;
    const gst = r.GSTINNO || null;
    const phone = r.MOBILE || r.PHONEOFF || null;
    const email = r.EMAIL || null;
    const billing = addr(r) || null;
    const creditLimit = Number(r.CREDIT_LIMIT_AMOUNT) || 0;
    const paymentTerms = r.CREDITDAYS ? `Net ${r.CREDITDAYS}` : null;

    const [existing] = await sqlpg`SELECT id FROM customers WHERE code=${code}`;
    if (existing) {
      await sqlpg`UPDATE customers SET name=${name}, gst=${gst}, email=${email}, phone=${phone},
        billing=${billing}, shipping=${billing}, credit_limit=${creditLimit}, payment_terms=${paymentTerms}
        WHERE id=${existing.id}`;
      updated++;
    } else {
      await sqlpg`INSERT INTO customers (code,name,gst,email,phone,billing,shipping,credit_limit,payment_terms)
        VALUES (${code},${name},${gst},${email},${phone},${billing},${billing},${creditLimit},${paymentTerms})`;
      inserted++;
    }
  }
  console.log(`  Customers: ${inserted} inserted, ${updated} updated.`);
}

async function importVendors() {
  console.log("Fetching vendors (real, purchased from this year) from Oracle...");
  const rows = await oraQuery(`
    select p.acntid, p.acntcode, p.acntdesc, p.gstinno, p.add1, p.add2, p.add3, p.add4, p.add5,
           p.mobile, p.phoneoff, p.email, p.contactperson, p.creditdays
      from SILVER_MASTER.DTA02 p
     where p.acntid in (select distinct partyid from VW_GST_INPUT)
     order by p.acntdesc`);
  console.log(`  ${rows.length} vendors found.`);

  let inserted = 0, updated = 0;
  for (const r of rows) {
    const code = String(r.ACNTCODE || `ORA-${r.ACNTID}`).trim();
    const name = String(r.ACNTDESC || "").trim();
    if (!name) continue;
    const gst = r.GSTINNO || null;
    const phone = r.MOBILE || r.PHONEOFF || null;
    const email = r.EMAIL || null;
    const contact = r.CONTACTPERSON || null;
    const paymentTerms = r.CREDITDAYS ? `Net ${r.CREDITDAYS}` : null;

    const [existing] = await sqlpg`SELECT id FROM vendors WHERE code=${code}`;
    if (existing) {
      await sqlpg`UPDATE vendors SET name=${name}, gst=${gst}, contact=${contact}, email=${email},
        phone=${phone}, payment_terms=${paymentTerms} WHERE id=${existing.id}`;
      updated++;
    } else {
      await sqlpg`INSERT INTO vendors (code,name,gst,contact,email,phone,payment_terms,status)
        VALUES (${code},${name},${gst},${contact},${email},${phone},${paymentTerms},'active')`;
      inserted++;
    }
  }
  console.log(`  Vendors: ${inserted} inserted, ${updated} updated.`);
}

async function importItems() {
  console.log("Fetching active items (with rates) from Oracle (paginated)...");
  const existing = new Set((await sqlpg`SELECT sku_code FROM skus`).map((r) => r.sku_code));
  console.log(`  ${existing.size} SKUs already in Postgres.`);

  const batchSize = 400;
  let start = 1, total = 0, inserted = 0, updated = 0;
  for (;;) {
    const end = start + batchSize - 1;
    const oraRows = await oraQuery(`
      select * from (
        select itemcode, itemdescription, maingroup, units, mrp, salerate, purchaserate,
               curryearpurcrate, hsncode, minlevel, orderlevel,
               row_number() over (order by itemcode) rn
          from SILVER_MASTER.DTA05
         where status = 'ACTIVE' and activestatus = 'ACTIVE'
      ) where rn between ${start} and ${end}`);
    if (oraRows.length === 0) break;
    total += oraRows.length;

    const seenThisBatch = new Set();
    const rows = [];
    for (const r of oraRows) {
      const code = String(r.ITEMCODE || "").trim().toUpperCase();
      const name = String(r.ITEMDESCRIPTION || "").trim();
      if (!code || !name || seenThisBatch.has(code)) continue;
      seenThisBatch.add(code);
      const isNew = !existing.has(code);
      rows.push({
        sku_code: code,
        name,
        category: (r.MAINGROUP || name.split(/\s+/)[0]).toString().toUpperCase(),
        unit: r.UNITS || "PCS",
        price: Number(r.MRP) || 0,
        purchase_price: Number(r.CURRYEARPURCRATE) || Number(r.PURCHASERATE) || 0,
        selling_price: Number(r.SALERATE) || Number(r.MRP) || 0,
        hsn: r.HSNCODE || "",
        min_stock: Number(r.MINLEVEL) || 0,
        reorder_level: Number(r.ORDERLEVEL) || 0,
        qr_token: `SQR-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
        _isNew: isNew,
      });
      existing.add(code);
    }
    if (rows.length === 0) { if (oraRows.length < batchSize) break; start += batchSize; continue; }

    const cols = ["sku_code", "name", "category", "unit", "price", "purchase_price", "selling_price", "hsn", "min_stock", "reorder_level", "qr_token"];
    const result = await sqlpg`
      INSERT INTO skus ${sqlpg(rows, ...cols)}
      ON CONFLICT (sku_code) DO UPDATE SET
        name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit, price=EXCLUDED.price,
        purchase_price=EXCLUDED.purchase_price, selling_price=EXCLUDED.selling_price, hsn=EXCLUDED.hsn,
        min_stock=EXCLUDED.min_stock, reorder_level=EXCLUDED.reorder_level
      RETURNING id, sku_code, (xmax = 0) AS just_inserted`;

    const newRows = result.filter((r) => r.just_inserted);
    if (newRows.length > 0) {
      const qrRows = newRows.map((r) => {
        const src = rows.find((x) => x.sku_code === r.sku_code);
        return { sku_id: r.id, sku_code: r.sku_code, token: src.qr_token, status: "active", created_by: "oracle-import" };
      });
      await sqlpg`INSERT INTO qr_codes ${sqlpg(qrRows, "sku_id", "sku_code", "token", "status", "created_by")}`;
    }
    inserted += newRows.length;
    updated += result.length - newRows.length;
    console.log(`  ...batch ${start}-${end}: ${result.length} upserted (${newRows.length} new) — running total ${inserted} inserted, ${updated} updated`);

    if (oraRows.length < batchSize) break;
    start += batchSize;
  }
  console.log(`  Items: ${total} processed, ${inserted} inserted, ${updated} updated.`);
}

await importCustomers();
await importVendors();
await importItems();
await sqlpg.end();
console.log("Done.");
