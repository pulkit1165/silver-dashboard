import "server-only";
import { getRawSql } from "./db";

// Unified Orders — ERP sales_orders + legacy Oracle sales (VW_SALE_D), one
// paginated list. Runs on getRawSql(): in production that Neon DB holds BOTH the
// ERP tables and oracle_raw, so this UNION is a single query. Read-only view.

export interface UnifiedOrderRow {
  order_no: string;
  ref: string;            // erp: so.id · oracle: doc-no (TRMID)
  source: "erp" | "oracle";
  dt: string;             // order date (YYYY-MM-DD)
  customer: string;
  salesman: string;
  transporter: string;
  state: string;
  value: number;
  status_key: string;     // orderStatus key, or 'delivered' for legacy
}
export interface UnifiedFilter { party?: string; salesman?: string; status?: string; from?: string; to?: string }

// The UNION CTE (shared by the paginated list + the export). `db` is the raw sql.
function unifiedCte(db: ReturnType<typeof getRawSql>) {
  return db`
    -- ERP orders (with a derived status key matching lib/erp/orderStatus.ts)
    SELECT so.so_no AS order_no, so.id::text AS ref, 'erp'::text AS source,
           COALESCE(NULLIF(so.order_date,''), LEFT(so.created_at, 10)) AS dt,
           COALESCE(c.name, '—') AS customer,
           COALESCE(NULLIF(so.salesman_name, ''), '') AS salesman,
           COALESCE(so.transporter, '') AS transporter, ''::text AS state,
           COALESCE(so.total, 0)::float8 AS value,
           CASE
             WHEN so.status = 'cancelled' THEN 'cancelled'
             WHEN so.status = 'decoded' THEN 'not-punched'
             WHEN so.status = 'draft' THEN 'draft'
             ELSE (SELECT CASE
                     WHEN d > 0 AND o > 0 AND d >= o THEN 'dispatched'
                     WHEN d > 0 THEN 'partial-dispatched'
                     WHEN p > 0 AND o > 0 AND p >= o THEN 'packed'
                     WHEN p > 0 THEN 'partial-packed'
                     ELSE 'punched' END
                   FROM (SELECT COALESCE(SUM(qty),0) o, COALESCE(SUM(packed_qty),0) p, COALESCE(SUM(dispatched_qty),0) d
                           FROM so_lines WHERE so_id = so.id) q)
           END AS status_key
      FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
    UNION ALL
    -- Legacy Oracle orders (VW_SALE_D header + transporter from the GST line view)
    SELECT sd.data->>'TRMID', sd.data->>'TRMID', 'oracle'::text,
           ((sd.data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text,
           COALESCE(NULLIF(sd.data->>'ACNTDESC',''), '—'), COALESCE(sd.data->>'AGENT',''),
           COALESCE(tp.tpt, '')::text, COALESCE(NULLIF(sd.data->>'STATE',''), ''),
           COALESCE(NULLIF(sd.data->>'SALEAMOUNT','')::numeric, NULLIF(sd.data->>'BILLAMOUNT','')::numeric, 0)::float8,
           'delivered'::text
      FROM oracle_raw sd
      LEFT JOIN (
        SELECT DISTINCT ON (data->>'TRMID') data->>'TRMID' AS trmid, data->>'TRANSPORT' AS tpt
          FROM oracle_raw WHERE source_table = 'VW_GST_SALE_ITEM' AND COALESCE(data->>'TRANSPORT','') <> ''
         ORDER BY data->>'TRMID'
      ) tp ON tp.trmid = sd.data->>'TRMID'
     WHERE sd.source_table = 'VW_SALE_D'`;
}

function whereFrag(db: ReturnType<typeof getRawSql>, f: UnifiedFilter) {
  const party = f.party?.trim() ? `%${f.party.trim()}%` : null;
  const salesman = f.salesman?.trim() ? `%${f.salesman.trim()}%` : null;
  const status = f.status?.trim() || null;
  const from = f.from?.trim() || null;
  const to = f.to?.trim() || null;
  return db`
    WHERE (${party}::text IS NULL OR customer ILIKE ${party})
      AND (${salesman}::text IS NULL OR salesman ILIKE ${salesman})
      AND (${status}::text IS NULL OR status_key = ${status})
      AND (${from}::text IS NULL OR dt >= ${from})
      AND (${to}::text IS NULL OR dt <= ${to})`;
}

const mapRow = (r: Record<string, unknown>): UnifiedOrderRow => ({
  order_no: String(r.order_no ?? ""), ref: String(r.ref ?? ""), source: r.source === "oracle" ? "oracle" : "erp",
  dt: String(r.dt ?? ""), customer: String(r.customer ?? ""), salesman: String(r.salesman ?? ""),
  transporter: String(r.transporter ?? ""), state: String(r.state ?? ""),
  value: Number(r.value) || 0, status_key: String(r.status_key ?? ""),
});

export async function getUnifiedOrders(
  f: UnifiedFilter, page = 1, pageSize = 60,
): Promise<{ rows: UnifiedOrderRow[]; total: number }> {
  try {
    const db = getRawSql();
    const off = (Math.max(1, page) - 1) * pageSize;
    const rows = (await db`
      WITH unified AS (${unifiedCte(db)})
      SELECT *, COUNT(*) OVER() AS total_count FROM unified
      ${whereFrag(db, f)}
      ORDER BY dt DESC NULLS LAST, order_no DESC
      LIMIT ${pageSize} OFFSET ${off}`) as unknown as Record<string, unknown>[];
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { rows: rows.map(mapRow), total };
  } catch {
    return { rows: [], total: 0 };
  }
}

export async function getUnifiedOrdersForExport(f: UnifiedFilter, cap = 10000): Promise<UnifiedOrderRow[]> {
  try {
    const db = getRawSql();
    const rows = (await db`
      WITH unified AS (${unifiedCte(db)})
      SELECT * FROM unified ${whereFrag(db, f)}
      ORDER BY dt DESC NULLS LAST, order_no DESC LIMIT ${cap}`) as unknown as Record<string, unknown>[];
    return rows.map(mapRow);
  } catch { return []; }
}

// ── Legacy Oracle order detail (VW_SALE_D header + VW_SALE_GST_D lines) ──────
export interface OracleOrderLine { code: string; name: string; qty: number; rate: number; amount: number; disc: number; hsn: string }
export interface OracleOrder {
  order_no: string; date: string; customer: string; customer_code: string; salesman: string;
  state: string; city: string; transporter: string; sale_amount: number; bill_amount: number; lines: OracleOrderLine[];
}
export async function getOracleOrder(docNo: string): Promise<OracleOrder | undefined> {
  const db = getRawSql();
  const [h] = (await db`
    SELECT data->>'TRMID' AS order_no,
           ((data->>'TRDATE')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS date,
           data->>'ACNTDESC' AS customer, data->>'ACNTCODE' AS customer_code, data->>'AGENT' AS salesman,
           data->>'STATE' AS state, data->>'CITYNAME' AS city,
           COALESCE(NULLIF(data->>'SALEAMOUNT','')::numeric,0)::float8 AS sale_amount,
           COALESCE(NULLIF(data->>'BILLAMOUNT','')::numeric,0)::float8 AS bill_amount
      FROM oracle_raw WHERE source_table='VW_SALE_D' AND data->>'TRMID'=${docNo} LIMIT 1`) as unknown as Record<string, unknown>[];
  if (!h) return undefined;
  const [tp] = (await db`
    SELECT data->>'TRANSPORT' AS transporter FROM oracle_raw
     WHERE source_table='VW_GST_SALE_ITEM' AND data->>'TRMID'=${docNo} AND COALESCE(data->>'TRANSPORT','')<>'' LIMIT 1`) as unknown as Record<string, unknown>[];
  const lines = (await db`
    SELECT data->>'ITEMCODE' AS code, data->>'ITEMDESCRIPTION' AS name,
           COALESCE(NULLIF(data->>'QUANTITY','')::numeric,0)::float8 AS qty,
           COALESCE(NULLIF(data->>'RATE','')::numeric,0)::float8 AS rate,
           COALESCE(NULLIF(data->>'AMOUNT','')::numeric,0)::float8 AS amount,
           COALESCE(NULLIF(data->>'DISCAMT','')::numeric,0)::float8 AS disc,
           COALESCE(data->>'HSNCODE','') AS hsn
      FROM oracle_raw WHERE source_table='VW_SALE_GST_D' AND data->>'TRMID'=${docNo}
      ORDER BY (data->>'ITEMCODE')`) as unknown as Record<string, unknown>[];
  return {
    order_no: String(h.order_no ?? docNo), date: String(h.date ?? ""), customer: String(h.customer ?? ""),
    customer_code: String(h.customer_code ?? ""), salesman: String(h.salesman ?? ""),
    state: String(h.state ?? ""), city: String(h.city ?? ""), transporter: String(tp?.transporter ?? ""),
    sale_amount: Number(h.sale_amount) || 0, bill_amount: Number(h.bill_amount) || 0,
    lines: lines.map((l) => ({
      code: String(l.code ?? ""), name: String(l.name ?? ""), qty: Number(l.qty) || 0,
      rate: Number(l.rate) || 0, amount: Number(l.amount) || 0, disc: Number(l.disc) || 0, hsn: String(l.hsn ?? ""),
    })),
  };
}
