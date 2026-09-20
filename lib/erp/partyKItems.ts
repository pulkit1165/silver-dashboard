import "server-only";
import { getSql } from "./db";

// Party → K-items assignment. Per customer, the item codes that are "K" (routed to
// the Silver Retailer Network / eligible for OGL). When such a party is picked on an
// order, its K-items auto-mark K and the order becomes O/K — see [[erp-retailer-network]].

let ensured: Promise<void> | null = null;
export function ensurePartyKItemsTable(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS party_k_items (
        id serial PRIMARY KEY,
        customer_id integer NOT NULL,
        code text,
        sku_id integer NOT NULL,
        sku_code text,
        created_by text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        UNIQUE (customer_id, sku_id)
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

/** The sku_ids that are K for one customer (for auto-marking order lines K). */
export async function getPartyKSkuIds(customerId: number): Promise<number[]> {
  try {
    await ensurePartyKItemsTable();
    const rows = (await getSql()`SELECT sku_id FROM party_k_items WHERE customer_id=${customerId}`) as unknown as Array<{ sku_id: number }>;
    return rows.map((r) => Number(r.sku_id)).filter(Boolean);
  } catch { return []; }
}

export interface PartyKRow { sku_id: number; sku_code: string }
/** The K-item rows for one customer (sku_id + code), for the Discount Master grid. */
export async function getPartyKRows(customerId: number): Promise<PartyKRow[]> {
  await ensurePartyKItemsTable();
  const rows = (await getSql()`SELECT sku_id, sku_code FROM party_k_items WHERE customer_id=${customerId}`) as unknown as Array<{ sku_id: number; sku_code: string }>;
  return rows.map((r) => ({ sku_id: Number(r.sku_id), sku_code: r.sku_code }));
}

/** Mark one item as K for a customer (idempotent). Returns false if item unknown. */
export async function setPartyKItem(customerId: number, skuId: number, createdBy: string): Promise<boolean> {
  await ensurePartyKItemsTable();
  const sql = getSql();
  const [sku] = (await sql`SELECT id, sku_code, code FROM skus WHERE id=${skuId}`) as unknown as Array<{ id: number; sku_code: string }>;
  if (!sku) return false;
  const [cust] = (await sql`SELECT code FROM customers WHERE id=${customerId}`) as unknown as Array<{ code: string | null }>;
  await sql`INSERT INTO party_k_items (customer_id, code, sku_id, sku_code, created_by)
    VALUES (${customerId}, ${cust?.code ?? ""}, ${skuId}, ${sku.sku_code}, ${createdBy})
    ON CONFLICT (customer_id, sku_id) DO NOTHING`;
  return true;
}

/** Remove one item's K assignment for a customer. */
export async function removePartyKItem(customerId: number, skuId: number): Promise<void> {
  await ensurePartyKItemsTable();
  await getSql()`DELETE FROM party_k_items WHERE customer_id=${customerId} AND sku_id=${skuId}`;
}
