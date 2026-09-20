import "server-only";
import { getSql } from "./db";
import { stockAnalytics, type Movement } from "./queries";

// ── Auto-generate a purchase indent from real sales velocity + stock cover ──
// Reuses stockAnalytics()'s existing fast/medium/slow/dead classification
// (tercile split over real outbound stock_moves, lib/erp/queries.ts:179-220)
// instead of adding a fourth, inconsistent classifier — see po-engine.ts and
// analytics.ts for the two other, deliberately-untouched ones already in the
// codebase. This never reads or writes skus.min_stock/reorder_level — those
// stay exactly the manually-curated, Master-Files-driven values they are
// today; days-of-cover is a separate suggestion layer on top.

// Confirmed with the business: protect the best sellers most, thinnest
// buffer on slow movers (the opposite of "restock fast movers less often").
export const TARGET_DAYS: Record<Movement, number> = {
  fast: 90, medium: 60, slow: 30, dead: 0, none: 0,
};

export type IndentCandidate = {
  skuId: number; skuCode: string; name: string;
  onHand: number; sold: number; movement: Movement;
  windowDays: number; targetDays: number; dailyRate: number;
  targetStock: number; suggestedQty: number;
};

export async function computeIndentCandidates(windowDays = 90): Promise<IndentCandidate[]> {
  const rows = await stockAnalytics(windowDays);
  const out: IndentCandidate[] = [];
  for (const r of rows) {
    const targetDays = TARGET_DAYS[r.movement];
    if (targetDays <= 0) continue; // dead/none — no auto-suggestion, nothing to protect
    const dailyRate = r.sold / windowDays;
    const targetStock = dailyRate * targetDays;
    const suggestedQty = Math.max(0, Math.ceil(targetStock - r.qty));
    if (suggestedQty <= 0) continue; // already at or above target cover
    out.push({
      skuId: r.id, skuCode: r.sku_code, name: r.name,
      onHand: r.qty, sold: r.sold, movement: r.movement,
      windowDays, targetDays, dailyRate, targetStock, suggestedQty,
    });
  }
  return out;
}

async function nextNo(prefix: string, table: string, col: string): Promise<string> {
  const sql = getSql();
  const [{ n }] = (await sql.unsafe(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${col}, '\\D', '', 'g'), ''))::int, 0) + 1 AS n FROM ${table}`,
  )) as unknown as { n: number }[];
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// Creates the indent FIRST (before any quotation exists) — the new entry
// point for the indent-first flow. Vendor/price stay unset (null/0) until
// the quotation stage picks a winner per line.
export async function createIndentFromAnalysis(actor: string, windowDays = 90): Promise<{ id: number; indentNo: string; lines: number }> {
  const { ensureQuotationTables } = await import("./purchaseQuotations");
  await ensureQuotationTables();
  const sql = getSql();
  const candidates = await computeIndentCandidates(windowDays);
  const indentNo = await nextNo("IND", "indents", "indent_no");
  const [ind] = (await sql`INSERT INTO indents (indent_no, status, created_by)
    VALUES (${indentNo}, 'draft', ${actor}) RETURNING id`) as unknown as { id: number }[];
  for (const c of candidates) {
    await sql`INSERT INTO indent_lines (indent_id, sku_id, item_name, qty, movement, on_hand, sold, target_days)
      VALUES (${ind.id}, ${c.skuId}, ${c.name}, ${c.suggestedQty}, ${c.movement}, ${c.onHand}, ${c.sold}, ${c.targetDays})`;
  }
  return { id: ind.id, indentNo, lines: candidates.length };
}
