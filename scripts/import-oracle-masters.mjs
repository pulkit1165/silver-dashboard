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
    headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "1", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || `Oracle query failed (${res.status})`);
  return body.rows;
}

// The connector caps any single query at 500 rows (safety guard against
// runaway queries) — so any result that could exceed that must be paged
// through with ROWNUM ranges. innerSelect must be a full "select ... from
// ..." (no trailing order by); orderBy is required for stable pagination.
async function oraQueryAllPaged(innerSelect, orderBy, pageSize = 400) {
  let start = 1;
  const all = [];
  for (;;) {
    const end = start + pageSize - 1;
    const rows = await oraQuery(`
      select * from (
        select x.*, rownum rnum from (${innerSelect} order by ${orderBy}) x
      ) where rnum between ${start} and ${end}`);
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
    start += pageSize;
  }
  return all;
}

const sqlpg = postgres(DB_URL, { prepare: false });

function addr(r) {
  return [r.ADD1, r.ADD2, r.ADD3, r.ADD4, r.ADD5].filter(Boolean).join(", ");
}

// Greatest of the three discount columns the legacy header can carry.
function bestDisc(r) {
  return Math.max(Number(r.DISCPERCENT) || 0, Number(r.DISCPERCENT18) || 0, Number(r.DISCPERCENT28) || 0);
}

async function importCustomers() {
  console.log("Fetching ALL active parties from Oracle party master (DTA02)...");
  const rows = await oraQueryAllPaged(
    `select p.acntid, p.acntcode, p.acntdesc, p.gstinno, p.add1, p.add2, p.add3, p.add4, p.add5,
            p.mobile, p.phoneoff, p.email, p.creditdays, p.credit_limit_amount
       from SILVER_MASTER.DTA02 p
      where p.status = 'ACTIVE' and p.acntdesc is not null`,
    "p.acntid",
  );
  console.log(`  ${rows.length} active parties found.`);

  console.log("  Backfilling standing discount % from each party's most recent Sales Order...");
  const discRows = await oraQueryAllPaged(
    `select partyid, discpercent, discpercent18, discpercent28 from (
       select partyid, discpercent, discpercent18, discpercent28,
              row_number() over (partition by partyid order by trdate desc) rn
         from DTC102
     ) where rn = 1`,
    "partyid",
  );
  const discByParty = new Map(discRows.map((r) => [Number(r.PARTYID), bestDisc(r)]));
  console.log(`  ${discByParty.size} parties have order history to derive a discount from.`);

  const batch = rows
    .map((r) => {
      const code = String(r.ACNTCODE || `ORA-${r.ACNTID}`).trim();
      const name = String(r.ACNTDESC || "").trim();
      if (!name) return null;
      return {
        code,
        name,
        gst: r.GSTINNO || null,
        phone: r.MOBILE || r.PHONEOFF || null,
        email: r.EMAIL || null,
        billing: addr(r) || null,
        credit_limit: Number(r.CREDIT_LIMIT_AMOUNT) || 0,
        payment_terms: r.CREDITDAYS ? `Net ${r.CREDITDAYS}` : null,
        discount_pct: discByParty.get(Number(r.ACNTID)) ?? 0,
        _hasHistory: discByParty.has(Number(r.ACNTID)),
      };
    })
    .filter(Boolean);

  // De-dup by code (legacy data sometimes repeats a code under multiple ids).
  const byCode = new Map();
  for (const r of batch) byCode.set(r.code, r);
  const finalRows = [...byCode.values()];

  const existingDisc = new Map(
    (await sqlpg`SELECT code, discount_pct FROM customers`).map((r) => [r.code, r.discount_pct]),
  );

  const cols = ["code", "name", "gst", "email", "phone", "billing", "shipping", "credit_limit", "payment_terms", "discount_pct"];
  const size = 400;
  let inserted = 0, updated = 0;
  for (let i = 0; i < finalRows.length; i += size) {
    const chunk = finalRows.slice(i, i + size).map((r) => ({
      code: r.code, name: r.name, gst: r.gst, email: r.email, phone: r.phone,
      billing: r.billing, shipping: r.billing, credit_limit: r.credit_limit, payment_terms: r.payment_terms,
      // Don't clobber a manually-set discount with 0 just because this party
      // has no Oracle order history — only overwrite when we have a real value.
      discount_pct: r._hasHistory ? r.discount_pct : (existingDisc.get(r.code) ?? 0),
    }));
    const result = await sqlpg`
      INSERT INTO customers ${sqlpg(chunk, ...cols)}
      ON CONFLICT (code) DO UPDATE SET
        name=EXCLUDED.name, gst=EXCLUDED.gst, email=EXCLUDED.email, phone=EXCLUDED.phone,
        billing=EXCLUDED.billing, shipping=EXCLUDED.shipping, credit_limit=EXCLUDED.credit_limit,
        payment_terms=EXCLUDED.payment_terms, discount_pct=EXCLUDED.discount_pct
      RETURNING (xmax = 0) AS just_inserted`;
    const newCount = result.filter((r) => r.just_inserted).length;
    inserted += newCount;
    updated += result.length - newCount;
    console.log(`  ...batch ${i + 1}-${Math.min(i + size, finalRows.length)}: ${result.length} upserted (${newCount} new)`);
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
  console.log("Fetching active items from Oracle item master (DTA05)...");
  const oraRows = await oraQueryAllPaged(
    `select itemid, itemcode, itemdescription, maingroup, units, mrp, salerate, purchaserate,
            curryearpurcrate, hsncode, minlevel, orderlevel, stdpack, stdpack2
       from SILVER_MASTER.DTA05
      where status = 'ACTIVE' and activestatus = 'ACTIVE'`,
    "itemid",
  );
  console.log(`  ${oraRows.length} active items found.`);

  console.log("  Backfilling MRP/GST rate from each item's most recent Sales Order line...");
  const histRows = await oraQueryAllPaged(
    `select itemid, rate, gstrate from (
       select a.itemid, a.rate, a.gstrate,
              row_number() over (partition by a.itemid order by h.trdate desc) rn
         from DTC102A a join DTC102 h on h.trmid = a.trmid
        where a.rate is not null and a.rate <> 0
     ) where rn = 1`,
    "itemid",
  );
  const histByItem = new Map(histRows.map((r) => [Number(r.ITEMID), { rate: Number(r.RATE) || 0, gst: Number(r.GSTRATE) || 0 }]));
  console.log(`  ${histByItem.size} items have order history to derive a rate from.`);

  const existing = new Set((await sqlpg`SELECT sku_code FROM skus`).map((r) => r.sku_code));
  console.log(`  ${existing.size} SKUs already in Postgres.`);

  const seen = new Set();
  const rows = [];
  for (const r of oraRows) {
    const code = String(r.ITEMCODE || "").trim().toUpperCase();
    const name = String(r.ITEMDESCRIPTION || "").trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    const hist = histByItem.get(Number(r.ITEMID));
    const masterMrp = Number(r.MRP) || 0;
    const price = masterMrp > 0 ? masterMrp : (hist?.rate ?? 0);
    rows.push({
      sku_code: code,
      name,
      category: (r.MAINGROUP || name.split(/\s+/)[0]).toString().toUpperCase(),
      unit: r.UNITS || "PCS",
      price,
      purchase_price: Number(r.CURRYEARPURCRATE) || Number(r.PURCHASERATE) || 0,
      selling_price: Number(r.SALERATE) || price,
      hsn: r.HSNCODE || "",
      gst_rate: hist?.gst > 0 ? hist.gst : 18,
      min_stock: Number(r.MINLEVEL) || 0,
      reorder_level: Number(r.ORDERLEVEL) || 0,
      master_qty: Number(r.STDPACK) || 0,
      single_qty: Number(r.STDPACK2) || 1,
      qr_token: `SQR-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
      _isNew: !existing.has(code),
    });
    existing.add(code);
  }

  const cols = [
    "sku_code", "name", "category", "unit", "price", "purchase_price", "selling_price", "hsn",
    "gst_rate", "min_stock", "reorder_level", "master_qty", "single_qty", "qr_token",
  ];
  const batchSize = 400;
  let inserted = 0, updated = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const result = await sqlpg`
      INSERT INTO skus ${sqlpg(chunk, ...cols)}
      ON CONFLICT (sku_code) DO UPDATE SET
        name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit, price=EXCLUDED.price,
        purchase_price=EXCLUDED.purchase_price, selling_price=EXCLUDED.selling_price, hsn=EXCLUDED.hsn,
        gst_rate=EXCLUDED.gst_rate, min_stock=EXCLUDED.min_stock, reorder_level=EXCLUDED.reorder_level,
        master_qty=EXCLUDED.master_qty, single_qty=EXCLUDED.single_qty
      RETURNING id, sku_code, (xmax = 0) AS just_inserted`;

    const newRows = result.filter((r) => r.just_inserted);
    if (newRows.length > 0) {
      const qrRows = newRows.map((r) => {
        const src = chunk.find((x) => x.sku_code === r.sku_code);
        return { sku_id: r.id, sku_code: r.sku_code, token: src.qr_token, status: "active", created_by: "oracle-import" };
      });
      await sqlpg`INSERT INTO qr_codes ${sqlpg(qrRows, "sku_id", "sku_code", "token", "status", "created_by")}`;
    }
    inserted += newRows.length;
    updated += result.length - newRows.length;
    console.log(`  ...batch ${i + 1}-${Math.min(i + batchSize, rows.length)}: ${result.length} upserted (${newRows.length} new)`);
  }
  console.log(`  Items: ${rows.length} processed, ${inserted} inserted, ${updated} updated.`);
}

// Remove SKUs in Postgres that don't match ANY real Oracle item code (leftover
// fake/seed data from before the real import existed) — but only if nothing
// else references them, so real usage is never silently destroyed.
async function cleanupFakeSkus() {
  console.log("Checking for leftover fake/test SKUs not present in Oracle...");
  const oraCodes = await oraQueryAllPaged(
    `select itemid, itemcode from SILVER_MASTER.DTA05 where itemcode is not null`,
    "itemid",
  );
  const realCodes = new Set(oraCodes.map((r) => String(r.ITEMCODE).trim().toUpperCase()));
  const pgSkus = await sqlpg`SELECT id, sku_code, name FROM skus`;
  const fake = pgSkus.filter((s) => !realCodes.has(String(s.sku_code).trim().toUpperCase()));
  if (fake.length === 0) { console.log("  None found."); return; }
  console.log(`  ${fake.length} SKU(s) don't match any real Oracle item code:`);
  for (const s of fake) console.log(`    - ${s.sku_code} (${s.name})`);

  const ids = fake.map((s) => s.id);
  const [{ n: refSo }] = await sqlpg`SELECT COUNT(*)::int n FROM so_lines WHERE sku_id IN ${sqlpg(ids)}`;
  const [{ n: refInv }] = await sqlpg`SELECT COUNT(*)::int n FROM inventory WHERE sku_id IN ${sqlpg(ids)} AND qty <> 0`;
  if (refSo > 0 || refInv > 0) {
    console.log(`  Skipping deletion — ${refSo} sales-order line(s) and ${refInv} inventory row(s) reference these. Review manually.`);
    return;
  }
  await sqlpg`DELETE FROM qr_codes WHERE sku_id IN ${sqlpg(ids)}`;
  await sqlpg`DELETE FROM inventory WHERE sku_id IN ${sqlpg(ids)}`;
  await sqlpg`DELETE FROM skus WHERE id IN ${sqlpg(ids)}`;
  console.log(`  Deleted ${fake.length} fake SKU(s).`);
}

await importCustomers();
await importVendors();
await importItems();
await cleanupFakeSkus();
await sqlpg.end();
console.log("Done.");
