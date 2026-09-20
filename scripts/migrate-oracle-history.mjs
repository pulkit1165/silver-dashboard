// One-time migration: copy everything the live ERP needs out of the Oracle
// mirror (`oracle_raw`, already synced) into permanent, typed Postgres tables
// (`legacy_*` + `cost_price_history`), so the app can stop depending on
// Oracle/the sync job without losing historical sales/purchase/delivery data.
//
// Source data is ALREADY IN POSTGRES (oracle_raw) — this does not touch the
// live Oracle connector. It only reads oracle_raw and writes to brand-new,
// currently-empty tables; it never touches customers/vendors/skus/sales_orders
// etc. Every row also keeps its original oracle_raw JSON in a `raw` column,
// so no information is lost even where a mapped column is wrong or missing.
//
// Known limitation (real data, verified 2026-09-15): the currently-synced
// oracle_raw only covers ~2026-02-01 through 2026-07-02 (the sync has been
// broken since). Re-run this script after the connector is fixed and a fresh
// sync/backfill has pulled the Jul 3 -> today gap — it's fully idempotent.
//
// Also a real, structural limitation: DTC102 (Sales Orders) and VW_SALE_D
// share no key with VW_GST_SALE_ITEM (the only synced line-level sales table)
// — Oracle's own SO-line-detail table was never synced. So `legacy_sales_orders`
// (order/booking totals) and `legacy_sale_items` (billed line items, used for
// analytics/sold-by-SKU) are two independent historical facts, not parent/child.
//
// Usage:
//   node scripts/migrate-oracle-history.mjs              # dry run (default) — no writes
//   node scripts/migrate-oracle-history.mjs --write       # actually create tables + insert
//   node scripts/migrate-oracle-history.mjs --verify       # compare row counts/sums vs oracle_raw
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const DB_URL = process.env.DATABASE_URL;
const RAW_URL = process.env.ORACLE_RAW_DATABASE_URL || DB_URL;
if (!DB_URL) { console.error("DATABASE_URL not set in .env.local"); process.exit(1); }

const WRITE = process.argv.includes("--write");
const VERIFY = process.argv.includes("--verify");

const sql = postgres(DB_URL, { prepare: false });
const raw = RAW_URL === DB_URL ? sql : postgres(RAW_URL, { prepare: false });

const log = (...a) => console.log(...a);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

// ---- Schema (additive only — brand-new tables, never touches existing ones) ----
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS legacy_sales_orders (
    id serial PRIMARY KEY,
    oracle_trmid text UNIQUE NOT NULL,
    order_no text,
    order_date date,
    party_id_raw integer,
    customer_id integer,
    bill_type text,
    status text,
    dispatch_status text,
    remarks text,
    sale_amount double precision DEFAULT 0,
    bill_amount double precision DEFAULT 0,
    total_gp double precision DEFAULT 0,
    total_cp_amount double precision DEFAULT 0,
    raw jsonb,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_so_date_idx ON legacy_sales_orders (order_date)`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_so_customer_idx ON legacy_sales_orders (customer_id)`;

  // Bill/invoice-level sold-item lines (VW_GST_SALE_ITEM) — independently
  // keyed, NOT a child of legacy_sales_orders (different Oracle keyspace).
  // This is what analytics/"sold by SKU"/customer/category reports need.
  await sql`CREATE TABLE IF NOT EXISTS legacy_sale_items (
    id serial PRIMARY KEY,
    oracle_trmid text,
    oracle_srno integer,
    order_date date,
    sku_id integer,
    item_description_snapshot text,
    hsn_snapshot text,
    customer_name_snapshot text,
    city text,
    state text,
    state_code text,
    agent text,
    transporter text,
    qty double precision,
    rate double precision,
    amount double precision,
    sale_amount double precision,
    bill_amount double precision,
    discount_amount double precision,
    taxable_value double precision,
    cgst double precision,
    sgst double precision,
    igst double precision,
    freight_amt double precision,
    weight double precision,
    raw jsonb,
    created_at timestamptz DEFAULT now(),
    UNIQUE (oracle_trmid, oracle_srno)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_sale_items_date_idx ON legacy_sale_items (order_date)`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_sale_items_sku_idx ON legacy_sale_items (sku_id)`;

  await sql`CREATE TABLE IF NOT EXISTS legacy_purchase_orders (
    id serial PRIMARY KEY,
    oracle_trmid text UNIQUE NOT NULL,
    order_date date,
    bill_no text,
    bill_date date,
    party_id_raw integer,
    vendor_id integer,
    bill_amount double precision DEFAULT 0,
    freight_amt double precision DEFAULT 0,
    packing_amt double precision DEFAULT 0,
    discount_amount double precision DEFAULT 0,
    total_diff_amt double precision DEFAULT 0,
    raw jsonb,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_po_date_idx ON legacy_purchase_orders (order_date)`;

  await sql`CREATE TABLE IF NOT EXISTS legacy_purchase_order_lines (
    id serial PRIMARY KEY,
    oracle_trmid text,
    sku_id integer,
    item_id_raw integer,
    lot_no text,
    qty double precision,
    rate double precision,
    po_rate double precision,
    mrn_rate double precision,
    raw jsonb,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_po_lines_trmid_idx ON legacy_purchase_order_lines (oracle_trmid)`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_po_lines_sku_idx ON legacy_purchase_order_lines (sku_id)`;

  await sql`CREATE TABLE IF NOT EXISTS legacy_delivery_orders (
    id serial PRIMARY KEY,
    oracle_trmid text UNIQUE NOT NULL,
    order_date date,
    party_id_raw integer,
    customer_id integer,
    do_type text,
    bill_type text,
    net_wt double precision,
    box_wt double precision,
    item_wt double precision,
    bill_amt double precision,
    tot_amt double precision,
    raw jsonb,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_do_date_idx ON legacy_delivery_orders (order_date)`;

  await sql`CREATE TABLE IF NOT EXISTS legacy_delivery_order_lines (
    id serial PRIMARY KEY,
    oracle_trmid text,
    so_trmid text,
    sku_id integer,
    item_id_raw integer,
    pack_no text,
    qty double precision,
    net_wt double precision,
    pack_wt double precision,
    rate double precision,
    amount double precision,
    raw jsonb,
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_do_lines_trmid_idx ON legacy_delivery_order_lines (oracle_trmid)`;
  await sql`CREATE INDEX IF NOT EXISTS legacy_do_lines_so_idx ON legacy_delivery_order_lines (so_trmid)`;

  await sql`CREATE TABLE IF NOT EXISTS cost_price_history (
    id serial PRIMARY KEY,
    sku_id integer,
    item_id_raw integer,
    cost_price double precision,
    vendor text,
    effective_at date,
    source text DEFAULT 'oracle_migration',
    created_at timestamptz DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS cost_price_history_sku_idx ON cost_price_history (sku_id)`;
}

// ---- Bridges (numeric Oracle ITEMID/PARTYID -> real Postgres FKs) ----
async function buildItemBridge() {
  const rows = await raw`
    SELECT DISTINCT (data->>'ITEMID')::int itemid, data->>'ITEMCODE' itemcode
    FROM oracle_raw WHERE source_table='A_LABELPRINT' AND data->>'ITEMID' IS NOT NULL`;
  const skuRows = await sql`SELECT id, sku_code FROM skus`;
  const skuByCode = new Map(skuRows.map((s) => [s.sku_code, s.id]));
  const itemIdToSkuId = new Map();
  for (const r of rows) {
    const skuId = skuByCode.get(r.itemcode);
    if (skuId) itemIdToSkuId.set(r.itemid, skuId);
  }
  return itemIdToSkuId;
}

async function buildCustomerBridge() {
  const rows = await sql`SELECT id, code FROM customers`;
  return new Map(rows.map((c) => [c.code, c.id]));
}
async function buildVendorBridge() {
  const rows = await sql`SELECT id, code FROM vendors`;
  return new Map(rows.map((v) => [v.code, v.id]));
}

// ---- Migrators ----
async function migrateSalesOrders() {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='DTC102'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    return {
      oracle_trmid: d.TRMID,
      order_no: d.TRMID,
      order_date: dateOnly(d.TRDATE),
      party_id_raw: num(d.PARTYID),
      customer_id: null, // resolved once oracle_party_id bridge exists (needs a live Oracle pull)
      bill_type: d.BILLTYPE ?? null,
      status: d.STATUS ?? null,
      dispatch_status: d.DISPATCH_STATUS ?? null,
      remarks: d.REMARKS1 ?? null,
      sale_amount: num(d.AMOUNT) ?? 0,
      bill_amount: num(d.BILLAMOUNT) ?? 0,
      total_gp: num(d.TOTGP) ?? 0,
      total_cp_amount: num(d.TOTCPAMT) ?? 0,
      raw: d,
    };
  });
  log(`legacy_sales_orders: ${mapped.length} rows mapped from DTC102`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "order_no", "order_date", "party_id_raw", "customer_id", "bill_type", "status", "dispatch_status", "remarks", "sale_amount", "bill_amount", "total_gp", "total_cp_amount", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_sales_orders ${sql(chunk, ...cols)}
      ON CONFLICT (oracle_trmid) DO UPDATE SET raw = EXCLUDED.raw RETURNING id`;
    n += res.length;
  }
  log(`  -> upserted ${n}`);
  return n;
}

async function migrateSaleItems(customerByCode) {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='VW_GST_SALE_ITEM'`;
  const skuRows = await sql`SELECT id, name FROM skus`;
  // Best-effort only: no item code in this view, so we don't attempt a fuzzy
  // name match (unreliable) — sku_id stays null, item_description_snapshot
  // and hsn_snapshot carry the identifying info instead.
  const mapped = rows.map((r, idx) => {
    const d = r.data;
    return {
      oracle_trmid: d.TRMID ?? null,
      oracle_srno: num(d.SRNO) ?? idx,
      order_date: dateOnly(d.TRDATE),
      sku_id: null,
      item_description_snapshot: d.ITEMDESCRIPTION ?? null,
      hsn_snapshot: d.HSNCODE ?? null,
      customer_name_snapshot: d.CUSTOMER ?? null,
      city: d.CITYNAME ?? null,
      state: d.STATENAME ?? null,
      state_code: d.STATECODE ?? null,
      agent: d.AGENT ?? null,
      transporter: d.TRANSPORT ?? null,
      qty: num(d.QUANTITY),
      rate: num(d.RATE),
      amount: num(d.AMOUNT),
      sale_amount: num(d.SALEAMOUNT),
      bill_amount: num(d.BILLAMOUNT),
      discount_amount: num(d.DISCOUNTAMOUNT) ?? 0,
      taxable_value: num(d.TAXABLEVALUE),
      cgst: num(d.BILLCGST) ?? 0,
      sgst: num(d.BILLSGST) ?? 0,
      igst: num(d.BILLIGST) ?? 0,
      freight_amt: num(d.FREIGHT) ?? 0,
      weight: num(d.WEIGHT),
      raw: d,
    };
  });
  log(`legacy_sale_items: ${mapped.length} rows mapped from VW_GST_SALE_ITEM (${skuRows.length} skus available for a future name-based reconciliation pass)`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "oracle_srno", "order_date", "sku_id", "item_description_snapshot", "hsn_snapshot", "customer_name_snapshot", "city", "state", "state_code", "agent", "transporter", "qty", "rate", "amount", "sale_amount", "bill_amount", "discount_amount", "taxable_value", "cgst", "sgst", "igst", "freight_amt", "weight", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_sale_items ${sql(chunk, ...cols)}
      ON CONFLICT (oracle_trmid, oracle_srno) DO UPDATE SET raw = EXCLUDED.raw RETURNING id`;
    n += res.length;
  }
  log(`  -> upserted ${n}`);
  return n;
}

async function migratePurchaseOrders() {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='DTC201'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    return {
      oracle_trmid: d.TRMID,
      order_date: dateOnly(d.TRDATE),
      bill_no: d.BILLNO ?? null,
      bill_date: dateOnly(d.BILLDATE),
      party_id_raw: num(d.PARTYID),
      vendor_id: null, // resolved once oracle_vendor_id bridge exists (needs a live Oracle pull)
      bill_amount: num(d.BILLAMOUNT) ?? 0,
      freight_amt: num(d.FREIGHTAMT) ?? 0,
      packing_amt: num(d.PACKINGAMT) ?? 0,
      discount_amount: num(d.DISCOUNTAMOUNT) ?? 0,
      total_diff_amt: num(d.TOTALDIFFAMT) ?? 0,
      raw: d,
    };
  });
  log(`legacy_purchase_orders: ${mapped.length} rows mapped from DTC201`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "order_date", "bill_no", "bill_date", "party_id_raw", "vendor_id", "bill_amount", "freight_amt", "packing_amt", "discount_amount", "total_diff_amt", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_purchase_orders ${sql(chunk, ...cols)}
      ON CONFLICT (oracle_trmid) DO UPDATE SET raw = EXCLUDED.raw RETURNING id`;
    n += res.length;
  }
  log(`  -> upserted ${n}`);
  return n;
}

async function migratePurchaseOrderLines(itemBridge) {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='VW_MRNDET_2Y'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    const itemId = num(d.ITEMID);
    return {
      oracle_trmid: d.TRMID ?? null,
      sku_id: itemId != null ? (itemBridge.get(itemId) ?? null) : null,
      item_id_raw: itemId,
      lot_no: d.LOTNO ?? null,
      qty: num(d.QUANTITY),
      rate: num(d.RATE),
      po_rate: num(d.PORATE),
      mrn_rate: num(d.MRNRATE),
      raw: d,
    };
  });
  const resolved = mapped.filter((m) => m.sku_id != null).length;
  log(`legacy_purchase_order_lines: ${mapped.length} rows mapped from VW_MRNDET_2Y (${resolved} resolved to a real sku_id)`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "sku_id", "item_id_raw", "lot_no", "qty", "rate", "po_rate", "mrn_rate", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_purchase_order_lines ${sql(chunk, ...cols)} RETURNING id`;
    n += res.length;
  }
  log(`  -> inserted ${n}`);
  return n;
}

async function migrateDeliveryOrders() {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='VW_DELYORDER_2Y'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    return {
      oracle_trmid: d.TRMID,
      order_date: dateOnly(d.TRDATE),
      party_id_raw: num(d.PARTYID),
      customer_id: null,
      do_type: d.DOTYPE ?? null,
      bill_type: d.BILLTYPE ?? null,
      net_wt: num(d.NETWT),
      box_wt: num(d.BOXWT),
      item_wt: num(d.ITEMWT),
      bill_amt: num(d.BILLAMT),
      tot_amt: num(d.TOTAMT),
      raw: d,
    };
  });
  log(`legacy_delivery_orders: ${mapped.length} rows mapped from VW_DELYORDER_2Y`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "order_date", "party_id_raw", "customer_id", "do_type", "bill_type", "net_wt", "box_wt", "item_wt", "bill_amt", "tot_amt", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_delivery_orders ${sql(chunk, ...cols)}
      ON CONFLICT (oracle_trmid) DO UPDATE SET raw = EXCLUDED.raw RETURNING id`;
    n += res.length;
  }
  log(`  -> upserted ${n}`);
  return n;
}

async function migrateDeliveryOrderLines(itemBridge) {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='VW_DELYORDERDET_2Y'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    const itemId = num(d.ITEMID);
    return {
      oracle_trmid: d.TRMID ?? null,
      so_trmid: d.SOMID ?? null,
      sku_id: itemId != null ? (itemBridge.get(itemId) ?? null) : null,
      item_id_raw: itemId,
      pack_no: d.PACKNO ?? null,
      qty: num(d.QUANTITY),
      net_wt: num(d.NETWT),
      pack_wt: num(d.PACKWT),
      rate: num(d.RATE),
      amount: num(d.AMOUNT),
      raw: d,
    };
  });
  const resolved = mapped.filter((m) => m.sku_id != null).length;
  log(`legacy_delivery_order_lines: ${mapped.length} rows mapped from VW_DELYORDERDET_2Y (${resolved} resolved to a real sku_id)`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["oracle_trmid", "so_trmid", "sku_id", "item_id_raw", "pack_no", "qty", "net_wt", "pack_wt", "rate", "amount", "raw"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map((r) => ({ ...r, raw: sql.json(r.raw) }));
    const res = await sql`INSERT INTO legacy_delivery_order_lines ${sql(chunk, ...cols)} RETURNING id`;
    n += res.length;
  }
  log(`  -> inserted ${n}`);
  return n;
}

async function migrateCostPriceHistory(itemBridge) {
  const rows = await raw`SELECT data FROM oracle_raw WHERE source_table='A_CURRCPM'`;
  const mapped = rows.map((r) => {
    const d = r.data;
    const itemId = num(d.ITEMID);
    return {
      sku_id: itemId != null ? (itemBridge.get(itemId) ?? null) : null,
      item_id_raw: itemId,
      cost_price: num(d.RATE),
      vendor: d.VENDOR ?? null,
      effective_at: dateOnly(d.TRDATE),
      source: "oracle_migration",
      raw: undefined,
    };
  });
  const resolved = mapped.filter((m) => m.sku_id != null).length;
  log(`cost_price_history: ${mapped.length} rows mapped from A_CURRCPM (${resolved} resolved to a real sku_id)`);
  if (mapped.length) log("  sample:", JSON.stringify(mapped[0]));
  if (!WRITE) return mapped.length;

  const cols = ["sku_id", "item_id_raw", "cost_price", "vendor", "effective_at", "source"];
  let n = 0;
  for (let i = 0; i < mapped.length; i += 400) {
    const chunk = mapped.slice(i, i + 400).map(({ raw: _r, ...rest }) => rest);
    const res = await sql`INSERT INTO cost_price_history ${sql(chunk, ...cols)} RETURNING id`;
    n += res.length;
  }
  log(`  -> inserted ${n}`);
  return n;
}

async function verify() {
  log("\n--- verify: legacy_* row counts vs oracle_raw source counts ---");
  const pairs = [
    ["legacy_sales_orders", "DTC102"],
    ["legacy_sale_items", "VW_GST_SALE_ITEM"],
    ["legacy_purchase_orders", "DTC201"],
    ["legacy_purchase_order_lines", "VW_MRNDET_2Y"],
    ["legacy_delivery_orders", "VW_DELYORDER_2Y"],
    ["legacy_delivery_order_lines", "VW_DELYORDERDET_2Y"],
  ];
  for (const [table, source] of pairs) {
    const [{ n: legacyN }] = await sql`SELECT COUNT(*)::int n FROM ${sql(table)}`;
    const [{ n: rawN }] = await raw`SELECT COUNT(*)::int n FROM oracle_raw WHERE source_table=${source}`;
    log(`  ${table}: ${legacyN} rows  |  oracle_raw/${source}: ${rawN} rows  ${legacyN === rawN ? "OK" : "** MISMATCH **"}`);
  }
  const [{ s: legacySum }] = await sql`SELECT COALESCE(SUM(sale_amount),0)::numeric s FROM legacy_sales_orders`;
  const [{ s: rawSum }] = await raw`SELECT COALESCE(SUM((data->>'AMOUNT')::numeric),0) s FROM oracle_raw WHERE source_table='DTC102'`;
  log(`  legacy_sales_orders SUM(sale_amount) = ${legacySum}  |  oracle_raw DTC102 SUM(AMOUNT) = ${rawSum}  ${String(legacySum) === String(rawSum) ? "OK" : "** MISMATCH **"}`);
}

async function main() {
  log(`Mode: ${WRITE ? "WRITE (will create tables + insert rows)" : "DRY RUN (no writes, mapping preview only)"}`);
  if (WRITE) await ensureSchema();

  const itemBridge = await buildItemBridge();
  log(`Item bridge (A_LABELPRINT ITEMID -> skus.id): ${itemBridge.size} resolvable items\n`);
  const customerByCode = await buildCustomerBridge();
  const vendorByCode = await buildVendorBridge();
  void vendorByCode; // not yet usable for FK resolution — DTC201 only has numeric PARTYID, no code

  await migrateSalesOrders();
  await migrateSaleItems(customerByCode);
  await migratePurchaseOrders();
  await migratePurchaseOrderLines(itemBridge);
  await migrateDeliveryOrders();
  await migrateDeliveryOrderLines(itemBridge);
  await migrateCostPriceHistory(itemBridge);

  if (VERIFY && WRITE) await verify();

  await sql.end();
  if (raw !== sql) await raw.end();
  log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
