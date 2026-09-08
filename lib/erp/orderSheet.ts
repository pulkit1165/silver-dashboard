import "server-only";
import { getSql } from "./db";

// The client's printed SALES-ORDER sheet:
//   columns: SR · CODE · ITEM DES · F(foc) · S(K qty) · BIN · MRP · QTY · FG · RM · DQTY · C/S NO
//   header : T = order total amount · P = pending-to-dispatch qty · D = delivering (dispatched) qty
// FG/RM (finished-good / raw-material) and BIN are placeholders — no data yet (BIN comes
// from a file the client will upload; FG/RM in future). C/S NO = case/package number(s)
// the line was packed into (packing-slip logic). S = the K (silver-retailer) quantity.

export interface OrderSheetLine {
  sr: number; code: string; name: string;
  foc: number; kQty: number; bin: string; mrp: number; qty: number;
  fg: string; rm: string; dqty: number; caseNo: string;
  amount: number;
}
export interface OrderSheet {
  soNo: string; customer: string; orderDate: string; billType: string; salesman: string;
  total: number; pendingQty: number; deliveringQty: number; pendingAmt: number; deliveringAmt: number;
  // party (from customer master)
  transporter: string; partyLevel: string; paymentTerms: string;
  creditLimit: number; outstanding: number; availableCredit: number; oldestPendingDays: number | null;
  lines: OrderSheetLine[];
}

// Party master gains a default transporter + a level/grade ("P mark") — self-migrating.
let sheetCols = false;
async function ensureSheetCols(): Promise<void> {
  if (sheetCols) return;
  try { await getSql().unsafe(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS transporter text DEFAULT '', ADD COLUMN IF NOT EXISTS grade text DEFAULT ''`); sheetCols = true; } catch { /* ignore */ }
}

export async function getOrderSheet(soId: number): Promise<OrderSheet | null> {
  const sql = getSql();
  await ensureSheetCols();
  const [so] = (await sql`
    SELECT so.id, so.so_no, so.order_date, COALESCE(so.bill_type,'') AS bill_type,
           COALESCE(so.total,0)::float8 AS total, COALESCE(so.salesman_name,'') AS salesman,
           COALESCE(NULLIF(so.transporter,''), c.transporter, '') AS transporter,
           so.customer_id,
           COALESCE(c.name, '') AS customer, COALESCE(c.grade,'') AS grade,
           COALESCE(c.payment_terms,'') AS payment_terms, COALESCE(c.credit_limit,0)::float8 AS credit_limit
    FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
    WHERE so.id = ${soId}`) as unknown as Array<{ id: number; so_no: string; order_date: string; bill_type: string; total: number; salesman: string; transporter: string; customer_id: number | null; customer: string; grade: string; payment_terms: string; credit_limit: number }>;
  if (!so) return null;

  // Outstanding = committed (non-draft/non-cancelled) order value for this party;
  // oldest such order that isn't fully dispatched = "how old is pending".
  let outstanding = 0, oldestPendingDays: number | null = null;
  if (so.customer_id) {
    const [o] = (await sql`SELECT COALESCE(SUM(total),0)::float8 AS os FROM sales_orders WHERE customer_id=${so.customer_id} AND status NOT IN ('draft','cancelled')`) as unknown as Array<{ os: number }>;
    outstanding = o?.os ?? 0;
    const [d] = (await sql`
      SELECT MIN(order_date) AS oldest FROM sales_orders so2
      WHERE so2.customer_id=${so.customer_id} AND so2.status NOT IN ('draft','cancelled','delivered','completed','invoiced')
        AND EXISTS (SELECT 1 FROM so_lines l WHERE l.so_id=so2.id AND COALESCE(l.qty,0) > COALESCE(l.dispatched_qty,0)+COALESCE(l.cancelled_qty,0))`) as unknown as Array<{ oldest: string | null }>;
    if (d?.oldest) { const days = Math.floor((Date.now() - new Date(d.oldest).getTime()) / 86400000); oldestPendingDays = days >= 0 ? days : null; }
  }

  const rows = (await sql`
    SELECT s.sku_code AS code, s.name,
           COALESCE(l.foc_qty,0)::float8      AS foc,
           COALESCE(l.qty,0)::float8          AS qty,
           COALESCE(l.dispatched_qty,0)::float8 AS dqty,
           COALESCE(l.cancelled_qty,0)::float8  AS cancelled,
           COALESCE(NULLIF(l.mrp,0), s.price, 0)::float8 AS mrp,
           COALESCE(l.price,0)::float8        AS rate,
           COALESCE(l.is_k,false)             AS is_k,
           (SELECT string_agg(DISTINCT NULLIF(p.package_no,''), ', ' ORDER BY NULLIF(p.package_no,''))
              FROM package_lines pl JOIN packages p ON p.id = pl.package_id
             WHERE pl.so_line_id = l.id)      AS case_no
    FROM so_lines l JOIN skus s ON s.id = l.sku_id
    WHERE l.so_id = ${soId}
    ORDER BY l.id`) as unknown as Array<{
      code: string; name: string; foc: number; qty: number; dqty: number; cancelled: number;
      mrp: number; rate: number; is_k: boolean; case_no: string | null;
    }>;

  const orderIsK = so.bill_type.toUpperCase() === "K";
  let pendingQty = 0, deliveringQty = 0, pendingAmt = 0, deliveringAmt = 0;
  const lines: OrderSheetLine[] = rows.map((r, i) => {
    const pend = Math.max(0, r.qty - r.dqty - r.cancelled);
    const kQty = orderIsK || r.is_k ? r.qty : 0;
    pendingQty += pend; deliveringQty += r.dqty;
    pendingAmt += pend * r.rate; deliveringAmt += r.dqty * r.rate;
    return {
      sr: i + 1, code: r.code, name: r.name,
      foc: r.foc, kQty, bin: "", mrp: r.mrp, qty: r.qty,
      fg: "", rm: "", dqty: r.dqty, caseNo: r.case_no ?? "",
      amount: r.qty * r.rate,
    };
  });

  const total = so.total || lines.reduce((s, l) => s + l.amount, 0);
  return {
    soNo: so.so_no, customer: so.customer, orderDate: so.order_date, billType: so.bill_type, salesman: so.salesman,
    total, pendingQty, deliveringQty,
    pendingAmt: Math.round(pendingAmt * 100) / 100, deliveringAmt: Math.round(deliveringAmt * 100) / 100,
    transporter: so.transporter, partyLevel: so.grade, paymentTerms: so.payment_terms,
    creditLimit: so.credit_limit, outstanding: Math.round(outstanding * 100) / 100,
    availableCredit: Math.round((so.credit_limit - outstanding) * 100) / 100, oldestPendingDays,
    lines,
  };
}
