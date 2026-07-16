import "server-only";
import { getSql } from "./db";
import type { SkuCandidate } from "./sales-decode";

/** Top-sold active SKUs with GP >= minGpPct (default 25%), sorted by lifetime qty sold. */
export async function getTopGpSkus(minGpPct = 25, limit = 20): Promise<SkuCandidate[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, sku_code, name, unit, price, selling_price, purchase_price
    FROM skus
    WHERE status = 'active'
      AND purchase_price > 0
      AND selling_price > 0
      AND (selling_price - purchase_price) / selling_price * 100 >= ${minGpPct}
    ORDER BY (
      SELECT COALESCE(SUM(qty), 0) FROM so_lines WHERE sku_id = skus.id
    ) DESC
    LIMIT ${limit}`) as unknown as Array<{
    id: number; sku_code: string; name: string; unit: string;
    price: number; selling_price: number; purchase_price: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    sku_code: r.sku_code,
    name: r.name,
    unit: r.unit,
    price: Number(r.price) || 0,
    selling_price: Number(r.selling_price) || 0,
    purchase_price: Number(r.purchase_price) || 0,
  }));
}
