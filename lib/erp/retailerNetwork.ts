import "server-only";
import { getSql } from "./db";

// ── Silver Retailer Network ─────────────────────────────────────────────────
// Orders (or the K-portion of split O/K orders) that belong to the OTHER firm.
// A line is "K" when the order's bill_type = 'K' (whole order) OR the order is
// 'O/K' and that line is flagged is_k. These are hidden from our Sales panel,
// aren't billed on our side, and are handled by the retailer firm from here.

export interface NetworkOrderRow {
  id: number; so_no: string; order_date: string; created_at: string;
  customer_name: string; salesman_name: string; bill_type: string;
  k_lines: number; k_qty: number; k_value: number; total_lines: number;
}

export async function getRetailerNetworkOrders(f: { party?: string; from?: string; to?: string } = {}): Promise<NetworkOrderRow[]> {
  const sql = getSql();
  const party = f.party?.trim() ? `%${f.party.trim()}%` : null;
  // a line belongs to the other firm when the whole order is K, or it's flagged on an O/K order
  return (await sql`
    SELECT so.id, so.so_no,
           COALESCE(NULLIF(so.order_date,''), LEFT(so.created_at,10)) AS order_date, so.created_at,
           COALESCE(c.name,'—') AS customer_name,
           COALESCE(NULLIF(so.salesman_name,''), u.name, '') AS salesman_name,
           COALESCE(so.bill_type,'') AS bill_type,
           (COUNT(l.id) FILTER (WHERE so.bill_type = 'K' OR l.is_k))::int AS k_lines,
           COALESCE((SUM(l.qty) FILTER (WHERE so.bill_type = 'K' OR l.is_k)),0)::float8 AS k_qty,
           COALESCE((SUM(l.qty * COALESCE(l.price,0)) FILTER (WHERE so.bill_type = 'K' OR l.is_k)),0)::float8 AS k_value,
           COUNT(l.id)::int AS total_lines
      FROM sales_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      LEFT JOIN users u ON u.id = so.salesman_id
      LEFT JOIN so_lines l ON l.so_id = so.id
     WHERE (so.bill_type = 'K'
            OR (so.bill_type = 'O/K' AND EXISTS (SELECT 1 FROM so_lines lk WHERE lk.so_id = so.id AND lk.is_k)))
       AND (${party}::text IS NULL OR c.name ILIKE ${party})
       AND (${f.from ?? null}::text IS NULL OR so.order_date >= ${f.from ?? null})
       AND (${f.to ?? null}::text IS NULL OR so.order_date <= ${f.to ?? null})
     GROUP BY so.id, c.name, u.name
     ORDER BY order_date DESC NULLS LAST, so.id DESC
     LIMIT 1000`) as unknown as NetworkOrderRow[];
}

export interface NetworkHeader { id: number; so_no: string; order_date: string; customer_name: string; salesman_name: string; bill_type: string }
export async function getNetworkHeader(soId: number): Promise<NetworkHeader | undefined> {
  const sql = getSql();
  const [h] = (await sql`
    SELECT so.id, COALESCE(so.so_no,'') AS so_no,
           COALESCE(NULLIF(so.order_date,''), LEFT(so.created_at,10)) AS order_date,
           COALESCE(c.name,'—') AS customer_name,
           COALESCE(NULLIF(so.salesman_name,''), u.name, '') AS salesman_name,
           COALESCE(so.bill_type,'') AS bill_type
      FROM sales_orders so LEFT JOIN customers c ON c.id=so.customer_id LEFT JOIN users u ON u.id=so.salesman_id
     WHERE so.id=${soId}`) as unknown as NetworkHeader[];
  return h;
}

// The K lines of one order (for the network order detail).
export interface NetworkLineRow {
  sku_code: string; name: string; qty: number; price: number; mrp: number; value: number;
}
export async function getRetailerNetworkLines(soId: number): Promise<NetworkLineRow[]> {
  const sql = getSql();
  return (await sql`
    SELECT COALESCE(s.sku_code,'') AS sku_code, COALESCE(s.name,'') AS name,
           COALESCE(l.qty,0)::float8 AS qty, COALESCE(l.price,0)::float8 AS price,
           COALESCE(l.mrp,0)::float8 AS mrp, (COALESCE(l.qty,0)*COALESCE(l.price,0))::float8 AS value
      FROM so_lines l
      JOIN sales_orders so ON so.id = l.so_id
      LEFT JOIN skus s ON s.id = l.sku_id
     WHERE l.so_id = ${soId} AND (so.bill_type = 'K' OR l.is_k)
     ORDER BY l.id`) as unknown as NetworkLineRow[];
}
