import "server-only";
import { getSql } from "./db";

// A reusable pricing scheme shared by many customers (see lib/erp/invoice-engine.ts
// resolveDiscountPct — class default, overridable per-SKU or per-customer).
export interface DiscountClassRow {
  id: number;
  code: string;
  name: string;
  whole_order_pct: number;
  active: boolean;
  customer_count: number;
}

export async function listDiscountClasses(): Promise<DiscountClassRow[]> {
  return (await getSql()`
    SELECT dc.id, dc.code, dc.name, dc.whole_order_pct, dc.active,
           COUNT(c.id)::int AS customer_count
    FROM discount_classes dc
    LEFT JOIN customers c ON c.discount_class_id = dc.id
    GROUP BY dc.id, dc.code, dc.name, dc.whole_order_pct, dc.active
    ORDER BY dc.code`) as unknown as DiscountClassRow[];
}

export async function createDiscountClass(input: { code: string; name: string; wholeOrderPct: number }): Promise<{ id: number } | { error: string }> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || !name) return { error: "Code and name are required." };
  const sql = getSql();
  const [existing] = await sql`SELECT id FROM discount_classes WHERE code=${code}`;
  if (existing) return { error: `A class with code "${code}" already exists.` };
  const [row] = await sql`
    INSERT INTO discount_classes (code, name, whole_order_pct, active)
    VALUES (${code}, ${name}, ${input.wholeOrderPct}, true) RETURNING id`;
  return { id: (row as { id: number }).id };
}

export async function updateDiscountClass(id: number, patch: { name?: string; wholeOrderPct?: number; active?: boolean }): Promise<{ ok: true } | { error: string }> {
  const sql = getSql();
  const [cur] = await sql`SELECT * FROM discount_classes WHERE id=${id}`;
  if (!cur) return { error: "Discount class not found." };
  const c = cur as { name: string; whole_order_pct: number; active: boolean };
  await sql`UPDATE discount_classes SET
    name=${patch.name ?? c.name},
    whole_order_pct=${patch.wholeOrderPct ?? c.whole_order_pct},
    active=${patch.active ?? c.active}
    WHERE id=${id}`;
  return { ok: true };
}
