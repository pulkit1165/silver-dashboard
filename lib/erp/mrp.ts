import "server-only";
import { getSql } from "./db";

// ── Master MRP with recency ────────────────────────────────────────────────
// Every MRP change is appended to mrp_history (audit + recency ledger). The
// SKU's LIVE mrp (skus.price — read by barcode/QR labels, new sales orders,
// invoices and stock value) is always synced to the MOST-RECENT entry, so the
// latest MRP propagates everywhere it's used. Existing sales orders / invoices
// keep their own snapshotted MRP, so setting a new MRP never rewrites history.

let ensured: Promise<void> | null = null;
export function ensureMrpTable(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS mrp_history (
        id serial PRIMARY KEY,
        sku_id integer NOT NULL,
        sku_code text,
        mrp double precision NOT NULL,
        effective_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        note text DEFAULT '',
        created_by text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
      await sql`CREATE INDEX IF NOT EXISTS mrp_hist_sku_idx ON mrp_history (sku_id)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export type MrpRow = {
  id: number; sku_code: string; name: string; category: string;
  price: number; last_mrp: number | null; last_mrp_at: string | null;
  last_mrp_by: string | null; prev_mrp: number | null; change_count: number;
};

// SKU list + current (live) MRP + latest-change info, for the master page.
export async function getSkusWithMrp(search?: string, cap = 400): Promise<MrpRow[]> {
  await ensureMrpTable();
  const sql = getSql();
  const like = search && search.trim() ? `%${search.trim()}%` : null;
  const rows = await sql`
    SELECT s.id, s.sku_code, s.name, s.category, COALESCE(s.price, 0) AS price,
           h.mrp AS last_mrp, h.effective_at AS last_mrp_at, h.created_by AS last_mrp_by,
           p.mrp AS prev_mrp, COALESCE(c.n, 0) AS change_count
      FROM skus s
      LEFT JOIN LATERAL (
        SELECT mrp, effective_at, created_by FROM mrp_history
         WHERE sku_id = s.id ORDER BY effective_at DESC, id DESC LIMIT 1
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT mrp FROM mrp_history
         WHERE sku_id = s.id ORDER BY effective_at DESC, id DESC OFFSET 1 LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS n FROM mrp_history WHERE sku_id = s.id
      ) c ON true
     WHERE (${like}::text IS NULL OR s.sku_code ILIKE ${like} OR s.name ILIKE ${like} OR s.category ILIKE ${like})
     ORDER BY s.sku_code
     LIMIT ${cap}`;
  return rows as unknown as MrpRow[];
}

export type MrpHistoryRow = { id: number; mrp: number; effective_at: string; note: string; created_by: string; created_at: string };
export async function getMrpHistory(skuId: number): Promise<MrpHistoryRow[]> {
  await ensureMrpTable();
  const sql = getSql();
  return (await sql`
    SELECT id, mrp, effective_at, note, created_by, created_at
      FROM mrp_history WHERE sku_id = ${skuId}
     ORDER BY effective_at DESC, id DESC LIMIT 100`) as unknown as MrpHistoryRow[];
}

export type SetMrpResult =
  | { ok: true; skuId: number; sku_code: string; mrp: number; effective: number }
  | { ok: false; error: string };

// Append a new MRP for a SKU, then sync the live MRP (skus.price) to the most
// recent entry. Accepts an sku id or an sku_code (for bulk uploads keyed by code).
export async function setMrp(opts: {
  skuId?: number; skuCode?: string; mrp: number; effectiveAt?: string; note?: string; actor?: string | null;
}): Promise<SetMrpResult> {
  const mrp = Number(opts.mrp);
  if (!Number.isFinite(mrp) || mrp < 0) return { ok: false, error: "MRP must be a non-negative number." };
  await ensureMrpTable();
  const sql = getSql();

  const [sku] = opts.skuId
    ? await sql`SELECT id, sku_code FROM skus WHERE id=${opts.skuId}`
    : await sql`SELECT id, sku_code FROM skus WHERE sku_code=${String(opts.skuCode ?? "").trim()}`;
  if (!sku) return { ok: false, error: `SKU ${opts.skuCode ?? opts.skuId} not found in the item master.` };
  const skuId = (sku as { id: number }).id;
  const skuCode = (sku as { sku_code: string }).sku_code;

  // normalise an optional effective date (YYYY-MM-DD → midnight; else full ts kept)
  const effAt = opts.effectiveAt && /^\d{4}-\d{2}-\d{2}/.test(opts.effectiveAt)
    ? (opts.effectiveAt.length <= 10 ? `${opts.effectiveAt} 00:00:00` : opts.effectiveAt)
    : null;

  if (effAt) {
    await sql`INSERT INTO mrp_history (sku_id, sku_code, mrp, effective_at, note, created_by)
      VALUES (${skuId}, ${skuCode}, ${mrp}, ${effAt}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  } else {
    await sql`INSERT INTO mrp_history (sku_id, sku_code, mrp, note, created_by)
      VALUES (${skuId}, ${skuCode}, ${mrp}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  }

  // recency: the live MRP is the most-recent entry (by effective date, then id)
  const [eff] = await sql`
    SELECT mrp FROM mrp_history WHERE sku_id=${skuId}
     ORDER BY effective_at DESC, id DESC LIMIT 1`;
  const effective = eff ? Number((eff as { mrp: number }).mrp) : mrp;
  await sql`UPDATE skus SET price=${effective} WHERE id=${skuId}`;

  return { ok: true, skuId, sku_code: skuCode, mrp, effective };
}
