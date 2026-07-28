import "server-only";
import { getRawSql } from "@/lib/erp/db";

// ── Analytics data layer ────────────────────────────────────────────────────
// Reads from oracle_raw (PostgreSQL JSONB) — NOT live Oracle.
// Dates in oracle_raw are ISO-8601 UTC (Oracle midnight IST = 18:30 UTC prev day).
// All date comparisons use AT TIME ZONE 'Asia/Kolkata' to get correct Indian dates.

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const t = (v: unknown) => String(v ?? "");

export type Range = { from: string; to: string };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function defaultRange(): Range {
  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 364);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export type DailyPoint  = { d: string; revenue: number; bills: number };
export type PurchasePoint = { d: string; amount: number; bills: number };
export type SkuRow      = { code: string; name: string; units: number; revenue: number };
export type CatRow      = { category: string; revenue: number; units: number };
export type CustomerRow = { customer: string; revenue: number; bills: number };
export type ReturnRow   = { customer: string; bills: number; avgDays: number; lastBill: string };
export type SlowRow     = { code: string; name: string; qty: number; lastSale: string; daysIdle: number };
export type ItemRow     = { code: string; name: string; units: number; revenue: number };
export type TransporterRow = { transporter: string; bills: number; value: number; weight: number };
export type StateRow    = { state: string; bills: number; value: number };
export type FreightRow  = { transporter: string; bills: number; freight: number };
export type Kpis        = { revenue: number; bills: number; units: number; skus: number; customers: number; aov: number };

// Daily sales grouped by Indian date — VW_SALE_D
export async function dailySales(range?: Range): Promise<DailyPoint[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ d: string; revenue: string; bills: string }[]>`
      SELECT
        ((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
        ROUND(SUM((data->>'SALEAMOUNT')::numeric)) AS revenue,
        COUNT(*) AS bills
      FROM oracle_raw
      WHERE source_table = 'VW_SALE_D'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY 1 ORDER BY 1
    `;
    return rows.map(row => ({ d: t(row.d), revenue: n(row.revenue), bills: n(row.bills) }));
  } catch { return []; }
}

// Daily purchase grouped by Indian date — DTC201
export async function dailyPurchase(range?: Range): Promise<PurchasePoint[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ d: string; amount: string; bills: string }[]>`
      SELECT
        ((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
        ROUND(SUM((data->>'BILLAMOUNT')::numeric)) AS amount,
        COUNT(*) AS bills
      FROM oracle_raw
      WHERE source_table = 'DTC201'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY 1 ORDER BY 1
    `;
    return rows.map(row => ({ d: t(row.d), amount: n(row.amount), bills: n(row.bills) }));
  } catch { return []; }
}

// Top SKUs by units sold — VW_SALE_GST_D
export async function soldBySku(range?: Range, limit = 60): Promise<SkuRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ code: string; name: string; units: string; revenue: string }[]>`
      SELECT
        data->>'ITEMCODE' AS code,
        MAX(data->>'ITEMDESCRIPTION') AS name,
        SUM((data->>'QUANTITY')::numeric) AS units,
        ROUND(SUM((data->>'AMOUNT')::numeric - COALESCE((data->>'DISCAMT')::numeric, 0))) AS revenue
      FROM oracle_raw
      WHERE source_table = 'VW_SALE_GST_D'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY data->>'ITEMCODE'
      ORDER BY units DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({ code: t(row.code), name: t(row.name), units: n(row.units), revenue: n(row.revenue) }));
  } catch { return []; }
}

// Sales by category — VW_SALE_GST_D × A_LABELPRINT
export async function salesByCategory(range?: Range, limit = 12): Promise<CatRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ category: string; revenue: string; units: string }[]>`
      SELECT
        COALESCE(a.data->>'ITEMCATEG', 'UNCATEGORIZED') AS category,
        ROUND(SUM((s.data->>'AMOUNT')::numeric - COALESCE((s.data->>'DISCAMT')::numeric, 0))) AS revenue,
        SUM((s.data->>'QUANTITY')::numeric) AS units
      FROM oracle_raw s
      LEFT JOIN oracle_raw a
        ON a.source_table = 'A_LABELPRINT'
        AND a.data->>'ITEMID' = s.data->>'ITEMID'
      WHERE s.source_table = 'VW_SALE_GST_D'
        AND (s.data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (s.data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY COALESCE(a.data->>'ITEMCATEG', 'UNCATEGORIZED')
      ORDER BY revenue DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({ category: t(row.category), revenue: n(row.revenue), units: n(row.units) }));
  } catch { return []; }
}

// Top customers by revenue — VW_SALE_D
export async function topCustomers(range?: Range, limit = 40): Promise<CustomerRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ customer: string; revenue: string; bills: string }[]>`
      SELECT
        data->>'ACNTDESC' AS customer,
        ROUND(SUM((data->>'SALEAMOUNT')::numeric)) AS revenue,
        COUNT(*) AS bills
      FROM oracle_raw
      WHERE source_table = 'VW_SALE_D'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY data->>'ACNTDESC'
      ORDER BY revenue DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({ customer: t(row.customer), revenue: n(row.revenue), bills: n(row.bills) }));
  } catch { return []; }
}

// A customer's items bought — VW_SALE_GST_D has ACNTDESC directly
export async function customerItems(customer: string, limit = 25): Promise<ItemRow[]> {
  try {
    const sql = getRawSql();
    const rows = await sql<{ code: string; name: string; units: string; revenue: string }[]>`
      SELECT
        data->>'ITEMCODE' AS code,
        MAX(data->>'ITEMDESCRIPTION') AS name,
        SUM((data->>'QUANTITY')::numeric) AS units,
        ROUND(SUM((data->>'AMOUNT')::numeric - COALESCE((data->>'DISCAMT')::numeric, 0))) AS revenue
      FROM oracle_raw
      WHERE source_table = 'VW_SALE_GST_D'
        AND data->>'ACNTDESC' = ${customer}
        AND (data->>'TRDATE')::timestamptz >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata' - interval '365 days')
      GROUP BY data->>'ITEMCODE'
      ORDER BY revenue DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({ code: t(row.code), name: t(row.name), units: n(row.units), revenue: n(row.revenue) }));
  } catch { return []; }
}

// Returning customers: average days between bills — VW_SALE_D
export async function returningCustomers(limit = 50): Promise<ReturnRow[]> {
  try {
    const sql = getRawSql();
    const rows = await sql<{ customer: string; bills: string; avg_days: string; last_bill: string }[]>`
      SELECT
        data->>'ACNTDESC' AS customer,
        COUNT(*) AS bills,
        ROUND(
          (MAX(((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date)
           - MIN(((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date)
          )::numeric / NULLIF(COUNT(*) - 1, 0), 1
        ) AS avg_days,
        MAX(((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date)::text AS last_bill
      FROM oracle_raw
      WHERE source_table = 'VW_SALE_D'
      GROUP BY data->>'ACNTDESC'
      HAVING COUNT(*) >= 2
      ORDER BY bills DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({
      customer: t(row.customer),
      bills: n(row.bills),
      avgDays: n(row.avg_days),
      lastBill: t(row.last_bill),
    }));
  } catch { return []; }
}

// Slow-moving stock: items with stock > 0, sorted by days since last sale — VW_STOCK_REQ × VW_SALE_GST_D
export async function slowMovingStock(limit = 60): Promise<SlowRow[]> {
  try {
    const sql = getRawSql();
    const rows = await sql<{ code: string; name: string; qty: string; last_sale: string; days_idle: string }[]>`
      SELECT
        s.data->>'ITEMCODE' AS code,
        s.data->>'ITEMDESC' AS name,
        (s.data->>'STOCK')::numeric AS qty,
        COALESCE(
          MAX(((g.data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date)::text,
          'never'
        ) AS last_sale,
        COALESCE(
          (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')::date
          - MAX(((g.data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date),
          9999
        ) AS days_idle
      FROM oracle_raw s
      LEFT JOIN oracle_raw g
        ON g.source_table = 'VW_SALE_GST_D'
        AND g.data->>'ITEMID' = s.data->>'ITEMID'
      WHERE s.source_table = 'VW_STOCK_REQ'
        AND (s.data->>'STOCK')::numeric > 0
      GROUP BY s.data->>'ITEMCODE', s.data->>'ITEMDESC', (s.data->>'STOCK')::numeric
      ORDER BY days_idle DESC, qty DESC
      LIMIT ${limit}
    `;
    return rows.map(row => ({
      code: t(row.code),
      name: t(row.name),
      qty: n(row.qty),
      lastSale: t(row.last_sale),
      daysIdle: n(row.days_idle),
    }));
  } catch { return []; }
}

// Transporter workload — VW_GST_SALE_ITEM grouped by TRANSPORT (the dispatch/LR
// field on the sale line). Ranks transporters by dispatched value, with the
// number of bills (consignments) and total weight moved.
export async function transporterWorkload(range?: Range, limit = 40): Promise<TransporterRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ transporter: string; bills: string; value: string; weight: string }[]>`
      SELECT
        COALESCE(NULLIF(TRIM(data->>'TRANSPORT'), ''), 'Unspecified') AS transporter,
        COUNT(DISTINCT data->>'TRMID') AS bills,
        ROUND(SUM((data->>'AMOUNT')::numeric)) AS value,
        ROUND(SUM(COALESCE((data->>'WEIGHT')::numeric, 0))) AS weight
      FROM oracle_raw
      WHERE source_table = 'VW_GST_SALE_ITEM'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY 1
      ORDER BY value DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map(row => ({ transporter: t(row.transporter), bills: n(row.bills), value: n(row.value), weight: n(row.weight) }));
  } catch { return []; }
}

// State-wise sale — VW_GST_SALE_ITEM grouped by the buyer's STATENAME (place of supply).
export async function stateWiseSale(range?: Range, limit = 40): Promise<StateRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ state: string; bills: string; value: string }[]>`
      SELECT
        COALESCE(NULLIF(TRIM(data->>'STATENAME'), ''), 'Unspecified') AS state,
        COUNT(DISTINCT data->>'TRMID') AS bills,
        ROUND(SUM((data->>'AMOUNT')::numeric)) AS value
      FROM oracle_raw
      WHERE source_table = 'VW_GST_SALE_ITEM'
        AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      GROUP BY 1
      ORDER BY value DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map(row => ({ state: t(row.state), bills: n(row.bills), value: n(row.value) }));
  } catch { return []; }
}

// Freight expense — VW_GST_SALE_ITEM. FRTAMT is a bill-level charge repeated on
// every line, so it's de-duplicated to one value per bill (TRMID) before summing,
// then grouped by transporter. FRTAMT can hold text ("NO FREIGHT GIVEN") — the
// regex guard keeps only genuine numbers.
export async function freightExpense(range?: Range, limit = 40): Promise<FreightRow[]> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const rows = await sql<{ transporter: string; bills: string; freight: string }[]>`
      WITH bills AS (
        SELECT DISTINCT
          data->>'TRMID' AS trmid,
          COALESCE(NULLIF(TRIM(data->>'TRANSPORT'), ''), 'Unspecified') AS transporter,
          CASE WHEN data->>'FRTAMT' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (data->>'FRTAMT')::numeric ELSE 0 END AS frt
        FROM oracle_raw
        WHERE source_table = 'VW_GST_SALE_ITEM'
          AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
          AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      )
      SELECT transporter, COUNT(*) AS bills, ROUND(SUM(frt)) AS freight
      FROM bills
      WHERE frt > 0
      GROUP BY transporter
      ORDER BY freight DESC NULLS LAST
      LIMIT ${limit}
    `;
    return rows.map(row => ({ transporter: t(row.transporter), bills: n(row.bills), freight: n(row.freight) }));
  } catch { return []; }
}

// Headline KPIs — VW_SALE_D for revenue/bills/customers, VW_SALE_GST_D for units/skus
export async function analyticsKpis(range?: Range): Promise<Kpis> {
  const r = range ?? defaultRange();
  try {
    const sql = getRawSql();
    const [saleRows, lineRows] = await Promise.all([
      sql<{ revenue: string; bills: string; customers: string }[]>`
        SELECT
          ROUND(SUM((data->>'SALEAMOUNT')::numeric)) AS revenue,
          COUNT(*) AS bills,
          COUNT(DISTINCT data->>'ACNTDESC') AS customers
        FROM oracle_raw
        WHERE source_table = 'VW_SALE_D'
          AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
          AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      `,
      sql<{ units: string; skus: string }[]>`
        SELECT
          SUM((data->>'QUANTITY')::numeric) AS units,
          COUNT(DISTINCT data->>'ITEMID') AS skus
        FROM oracle_raw
        WHERE source_table = 'VW_SALE_GST_D'
          AND (data->>'TRDATE')::timestamptz >= ${r.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata'
          AND (data->>'TRDATE')::timestamptz <  (${r.to}::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Kolkata'
      `,
    ]);
    const revenue = n(saleRows[0]?.revenue), bills = n(saleRows[0]?.bills);
    return {
      revenue, bills,
      customers: n(saleRows[0]?.customers),
      units: n(lineRows[0]?.units),
      skus: n(lineRows[0]?.skus),
      aov: bills > 0 ? Math.round(revenue / bills) : 0,
    };
  } catch {
    return { revenue: 0, bills: 0, units: 0, skus: 0, customers: 0, aov: 0 };
  }
}

export type AnalyticsBundle = {
  live: boolean;
  from: string;
  to: string;
  generatedAt: string;
  kpis: Kpis;
  daily: DailyPoint[];
  purchase: PurchasePoint[];
  sku: SkuRow[];
  category: CatRow[];
  customers: CustomerRow[];
  returning: ReturnRow[];
  slow: SlowRow[];
  transporter: TransporterRow[];
  state: StateRow[];
  freight: FreightRow[];
};

export async function getAnalytics(range?: Range, nowIso = ""): Promise<AnalyticsBundle> {
  const r = range && isDate(range.from) && isDate(range.to) ? range : defaultRange();
  const [kpis, daily, purchase, sku, category, customers, returning, slow, transporter, state, freight] = await Promise.all([
    analyticsKpis(r), dailySales(r), dailyPurchase(r), soldBySku(r), salesByCategory(r),
    topCustomers(r), returningCustomers(), slowMovingStock(), transporterWorkload(r), stateWiseSale(r), freightExpense(r),
  ]);
  const live = daily.length + sku.length + customers.length > 0;
  return { live, from: r.from, to: r.to, generatedAt: nowIso, kpis, daily, purchase, sku, category, customers, returning, slow, transporter, state, freight };
}
