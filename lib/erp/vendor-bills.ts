import "server-only";
import { getSql } from "./db";
import { logActivity } from "./activity";
import type { VendorBillableRow, VendorBillRow } from "./types";

// Queue for the vendor-billing screen: POs with verified-but-unbilled qty —
// the purchase-side mirror of getPendingToBill(). Billable qty per po_line =
// SUM(verified goods_receipt_lines.qty) - SUM(already-billed vendor_bill_lines.qty),
// same derived-join shape used on the sales side (no stored "billed_qty" column).
export async function getVendorBillable(): Promise<VendorBillableRow[]> {
  const sql = getSql();
  return (await sql`
    SELECT po.id AS po_id, po.po_no, v.name AS vendor_name, po.order_date, po.status,
           COUNT(pl.id)::int AS lines,
           COALESCE(SUM(vg.verified_qty),0)::float8 AS received_qty,
           COALESCE(SUM(vb.billed_qty),0)::float8 AS billed_qty,
           COALESCE(SUM(GREATEST(COALESCE(vg.verified_qty,0) - COALESCE(vb.billed_qty,0),0)),0)::float8 AS billable_qty
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    JOIN po_lines pl ON pl.po_id = po.id
    LEFT JOIN (
      SELECT gl.po_line_id, SUM(gl.qty)::float8 AS verified_qty
      FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.grn_id
      WHERE g.status = 'verified' GROUP BY gl.po_line_id
    ) vg ON vg.po_line_id = pl.id
    LEFT JOIN (
      SELECT bl.po_line_id, SUM(bl.qty)::float8 AS billed_qty
      FROM vendor_bill_lines bl GROUP BY bl.po_line_id
    ) vb ON vb.po_line_id = pl.id
    GROUP BY po.id, po.po_no, v.name, po.order_date, po.status
    HAVING COALESCE(SUM(GREATEST(COALESCE(vg.verified_qty,0) - COALESCE(vb.billed_qty,0),0)),0) > 0
    ORDER BY po.order_date, po.id`) as unknown as VendorBillableRow[];
}

export async function createVendorBill(
  poId: number,
  opts: { billNo?: string; billDate?: string; createdBy?: string | null } = {},
): Promise<{ id: number } | { error: string }> {
  const sql = getSql();
  return await sql.begin(async (tx) => {
    const [po] = (await tx`SELECT id, vendor_id FROM purchase_orders WHERE id=${poId}`) as unknown as Array<{ id: number; vendor_id: number }>;
    if (!po) return { error: "Purchase order not found." };

    const rows = (await tx`
      SELECT pl.id AS po_line_id, pl.sku_id, pl.price AS rate,
             GREATEST(COALESCE(vg.verified_qty,0) - COALESCE(vb.billed_qty,0), 0) AS billable
      FROM po_lines pl
      LEFT JOIN (
        SELECT gl.po_line_id, SUM(gl.qty)::float8 AS verified_qty
        FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.grn_id
        WHERE g.status = 'verified' GROUP BY gl.po_line_id
      ) vg ON vg.po_line_id = pl.id
      LEFT JOIN (
        SELECT bl.po_line_id, SUM(bl.qty)::float8 AS billed_qty FROM vendor_bill_lines bl GROUP BY bl.po_line_id
      ) vb ON vb.po_line_id = pl.id
      WHERE pl.po_id = ${poId}`) as unknown as Array<{ po_line_id: number; sku_id: number; rate: number; billable: number }>;

    const billable = rows.filter((r) => r.billable > 0);
    if (billable.length === 0) return { error: "Nothing to bill — no verified receipt qty remaining on this PO." };

    const total = billable.reduce((a, r) => a + r.billable * (r.rate ?? 0), 0);
    const [bill] = await tx`
      INSERT INTO vendor_bills (po_id, vendor_id, bill_no, bill_date, status, total, created_by)
      VALUES (${poId}, ${po.vendor_id}, ${opts.billNo ?? ""}, ${opts.billDate ?? null}, 'draft', ${total}, ${opts.createdBy ?? null})
      RETURNING id`;
    const billId = (bill as { id: number }).id;
    for (const r of billable) {
      await tx`INSERT INTO vendor_bill_lines (bill_id, po_line_id, sku_id, qty, rate, amount)
        VALUES (${billId}, ${r.po_line_id}, ${r.sku_id}, ${r.billable}, ${r.rate ?? 0}, ${r.billable * (r.rate ?? 0)})`;
    }
    return { id: billId };
  });
}

export interface VendorBillFilter { vendor?: string; from?: string; to?: string; status?: string }
export async function listVendorBills(f: VendorBillFilter = {}): Promise<VendorBillRow[]> {
  const sql = getSql();
  const vendor = f.vendor?.trim() ? `%${f.vendor.trim()}%` : null;
  return (await sql`
    SELECT b.id, b.bill_no, b.bill_date, b.status, b.total, po.po_no, v.name AS vendor_name
    FROM vendor_bills b
    JOIN purchase_orders po ON po.id = b.po_id
    JOIN vendors v ON v.id = b.vendor_id
    WHERE (${vendor}::text IS NULL OR v.name ILIKE ${vendor})
      AND (${f.from ?? null}::text IS NULL OR b.bill_date >= ${f.from ?? null})
      AND (${f.to ?? null}::text IS NULL OR b.bill_date <= ${f.to ?? null})
      AND (${f.status ?? null}::text IS NULL OR b.status = ${f.status ?? null})
    ORDER BY b.id DESC LIMIT 200`) as unknown as VendorBillRow[];
}

export async function logVendorBillActivity(actor: string, actorRole: string, billId: number, poId: number) {
  await logActivity({ actor, actorRole, action: "vendor_bill.create", entity: "vendor_bill", entityId: billId, summary: `Vendor bill #${billId} created for PO #${poId}` });
}
