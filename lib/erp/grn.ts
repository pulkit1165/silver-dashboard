import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getSql } from "./db";
import { logActivity } from "./activity";

type Client = Sql | TransactionSql<Record<string, never>>;

async function adjustInventory(client: Client, skuId: number, whId: number, binId: number, batch: string, delta: number) {
  await client`
    INSERT INTO inventory (sku_id,warehouse_id,bin_id,batch,qty) VALUES (${skuId},${whId},${binId},${batch},${delta})
    ON CONFLICT (sku_id,warehouse_id,bin_id,batch) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty`;
}

async function logMove(client: Client, skuId: number, whId: number, binId: number, type: string, qty: number, ref: string, userId: number) {
  await client`INSERT INTO stock_moves (sku_id,warehouse_id,bin_id,type,qty,ref_doc,user_id) VALUES (${skuId},${whId},${binId},${type},${qty},${ref},${userId})`;
}

export interface ReceiveLine { poLineId: number; skuId: number; qty: number }
export interface ReceiveInput {
  poId: number;
  warehouseId: number;
  binId?: number;
  user: { id: number; name: string };
  lines: ReceiveLine[];
}

/**
 * Record a goods receipt against a PO — the purchase-side mirror of
 * lib/erp/scan.ts's pack_case: one transaction, adds stock (opposite
 * direction from pack_case), bumps po_lines.received_qty, recomputes the
 * PO's status, and logs everything to stock_moves/activity_log.
 */
export async function receiveGoods(input: ReceiveInput): Promise<{ ok: true; grnId: number } | { error: string }> {
  const sql = getSql();
  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) return { error: "Nothing to receive — enter a qty for at least one line." };

  try {
    const grnId = await sql.begin(async (tx) => {
      const [po] = await tx`SELECT id, po_no FROM purchase_orders WHERE id=${input.poId}`;
      if (!po) throw new Error(`Purchase order #${input.poId} not found`);
      const poRow = po as { id: number; po_no: string };

      const [{ next }] = await tx`SELECT COALESCE(MAX(id),0) + 1 AS next FROM goods_receipts`;
      const grnNo = `GRN-${next}`;
      const [grn] = await tx`
        INSERT INTO goods_receipts (po_id, grn_no, status, created_by) VALUES (${input.poId}, ${grnNo}, 'received', ${input.user.name})
        RETURNING id`;
      const grnId = (grn as { id: number }).id;
      const binId = input.binId ?? 0;

      for (const l of lines) {
        const [poLine] = await tx`SELECT id, qty, received_qty FROM po_lines WHERE id=${l.poLineId} AND po_id=${input.poId}`;
        if (!poLine) throw new Error(`Line ${l.poLineId} is not on PO ${poRow.po_no}`);
        await tx`INSERT INTO goods_receipt_lines (grn_id, po_line_id, sku_id, qty) VALUES (${grnId}, ${l.poLineId}, ${l.skuId}, ${l.qty})`;
        await adjustInventory(tx, l.skuId, input.warehouseId, binId, "", l.qty);
        await logMove(tx, l.skuId, input.warehouseId, binId, "in", l.qty, `${poRow.po_no} / ${grnNo}`, input.user.id);
        await tx`UPDATE po_lines SET received_qty = received_qty + ${l.qty} WHERE id=${l.poLineId}`;
      }

      const poLines = (await tx`SELECT qty, received_qty FROM po_lines WHERE po_id=${input.poId}`) as unknown as
        Array<{ qty: number; received_qty: number }>;
      const allReceived = poLines.every((x) => x.received_qty >= x.qty);
      const anyReceived = poLines.some((x) => x.received_qty > 0);
      const status = allReceived ? "received" : anyReceived ? "partially received" : "draft";
      await tx`UPDATE purchase_orders SET status=${status} WHERE id=${input.poId}`;

      return grnId;
    });

    await logActivity({
      actor: input.user.name, actorRole: null,
      action: "grn.receive", entity: "goods_receipt", entityId: grnId,
      summary: `Received ${lines.length} line(s) against PO #${input.poId}`,
      meta: { poId: input.poId, lines },
    });
    return { ok: true, grnId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Marks a received GRN as verified — the gate that makes it vendor-billable. */
export async function verifyGoodsReceipt(grnId: number): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [grn] = (await sql`UPDATE goods_receipts SET status='verified' WHERE id=${grnId} AND status='received' RETURNING id`) as unknown as Array<{ id: number }>;
  return grn ? { ok: true } : { error: "Goods receipt not found or not in received status." };
}
