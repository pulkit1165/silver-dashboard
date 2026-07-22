import "server-only";
import { getSql } from "./db";

/**
 * Versioned pricing masters — item-wise net rate, FOC %, and party discount %.
 *
 * Each is an append-only recency ledger (exactly like mrp_history): the LIVE
 * value is the most-recent row, mirrored onto a fast column so the sales screen
 * and the order writer read it cheaply:
 *   item_net_rates    -> skus.item_net_rate   (0 = none; overrides party disc%)
 *   foc_rates         -> skus.foc_pct         (0 = none; applied last)  [FOC file: later]
 *   party_disc_history-> customers.discount_pct
 *
 * Nothing is ever deleted, so every master page can show a "previous value"
 * column and a full change history. Tables + mirror columns self-create on
 * first use, so production migrates itself with no manual db:push.
 */

let ensured: Promise<void> | null = null;
export function ensurePricingTables(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS item_net_rates (
        id serial PRIMARY KEY, sku_id integer NOT NULL, sku_code text,
        net_rate double precision NOT NULL,
        effective_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        note text DEFAULT '', created_by text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`;
      await sql`CREATE INDEX IF NOT EXISTS inr_sku_idx ON item_net_rates (sku_id)`;
      await sql`CREATE TABLE IF NOT EXISTS foc_rates (
        id serial PRIMARY KEY, sku_id integer NOT NULL, sku_code text,
        foc_pct double precision NOT NULL,
        effective_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        note text DEFAULT '', created_by text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`;
      await sql`CREATE INDEX IF NOT EXISTS foc_sku_idx ON foc_rates (sku_id)`;
      await sql`CREATE TABLE IF NOT EXISTS party_disc_history (
        id serial PRIMARY KEY, customer_id integer NOT NULL, code text,
        disc_pct double precision NOT NULL,
        effective_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
        note text DEFAULT '', created_by text,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`;
      await sql`CREATE INDEX IF NOT EXISTS pdh_cust_idx ON party_disc_history (customer_id)`;
      await sql.unsafe(`ALTER TABLE skus
        ADD COLUMN IF NOT EXISTS item_net_rate double precision DEFAULT 0,
        ADD COLUMN IF NOT EXISTS foc_pct double precision DEFAULT 0`);
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// ── Item-wise net rate master ──────────────────────────────────────────────
export type NetRateRow = {
  id: number; sku_code: string; name: string; category: string; price: number;
  net_rate: number; last_net_rate: number | null; last_net_rate_at: string | null;
  last_net_rate_by: string | null; prev_net_rate: number | null; change_count: number;
};

export async function getSkusWithNetRate(search?: string, cap = 400): Promise<NetRateRow[]> {
  await ensurePricingTables();
  const sql = getSql();
  const like = search && search.trim() ? `%${search.trim()}%` : null;
  return (await sql`
    SELECT s.id, s.sku_code, s.name, s.category, COALESCE(s.price,0) AS price,
           COALESCE(s.item_net_rate,0) AS net_rate,
           h.net_rate AS last_net_rate, h.effective_at AS last_net_rate_at, h.created_by AS last_net_rate_by,
           p.net_rate AS prev_net_rate, COALESCE(c.n,0) AS change_count
      FROM skus s
      LEFT JOIN LATERAL (SELECT net_rate, effective_at, created_by FROM item_net_rates
                          WHERE sku_id=s.id ORDER BY effective_at DESC, id DESC LIMIT 1) h ON true
      LEFT JOIN LATERAL (SELECT net_rate FROM item_net_rates
                          WHERE sku_id=s.id ORDER BY effective_at DESC, id DESC OFFSET 1 LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM item_net_rates WHERE sku_id=s.id) c ON true
     WHERE (${like}::text IS NULL OR s.sku_code ILIKE ${like} OR s.name ILIKE ${like} OR s.category ILIKE ${like})
     ORDER BY s.sku_code LIMIT ${cap}`) as unknown as NetRateRow[];
}

export type NetRateHistoryRow = { id: number; net_rate: number; effective_at: string; note: string; created_by: string; created_at: string };
export async function getNetRateHistory(skuId: number): Promise<NetRateHistoryRow[]> {
  await ensurePricingTables();
  return (await getSql()`
    SELECT id, net_rate, effective_at, note, created_by, created_at
      FROM item_net_rates WHERE sku_id=${skuId} ORDER BY effective_at DESC, id DESC LIMIT 100`) as unknown as NetRateHistoryRow[];
}

export type SetNetRateResult =
  | { ok: true; skuId: number; sku_code: string; effective: number }
  | { ok: false; error: string };

// Append a new item net rate, then mirror the most-recent value to skus.item_net_rate.
// A net_rate of 0 clears the override (party disc% resumes for that SKU).
export async function setItemNetRate(opts: {
  skuId?: number; skuCode?: string; netRate: number; effectiveAt?: string; note?: string; actor?: string | null;
}): Promise<SetNetRateResult> {
  const netRate = Number(opts.netRate);
  if (!Number.isFinite(netRate) || netRate < 0) return { ok: false, error: "Net rate must be a non-negative number." };
  await ensurePricingTables();
  const sql = getSql();
  const [sku] = opts.skuId
    ? await sql`SELECT id, sku_code FROM skus WHERE id=${opts.skuId}`
    : await sql`SELECT id, sku_code FROM skus WHERE sku_code=${String(opts.skuCode ?? "").trim()}`;
  if (!sku) return { ok: false, error: `SKU ${opts.skuCode ?? opts.skuId} not found in the item master.` };
  const skuId = (sku as { id: number }).id;
  const skuCode = (sku as { sku_code: string }).sku_code;

  const effAt = opts.effectiveAt && /^\d{4}-\d{2}-\d{2}/.test(opts.effectiveAt)
    ? (opts.effectiveAt.length <= 10 ? `${opts.effectiveAt} 00:00:00` : opts.effectiveAt) : null;
  if (effAt) {
    await sql`INSERT INTO item_net_rates (sku_id, sku_code, net_rate, effective_at, note, created_by)
      VALUES (${skuId}, ${skuCode}, ${netRate}, ${effAt}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  } else {
    await sql`INSERT INTO item_net_rates (sku_id, sku_code, net_rate, note, created_by)
      VALUES (${skuId}, ${skuCode}, ${netRate}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  }
  const [eff] = await sql`SELECT net_rate FROM item_net_rates WHERE sku_id=${skuId} ORDER BY effective_at DESC, id DESC LIMIT 1`;
  const effective = eff ? Number((eff as { net_rate: number }).net_rate) : netRate;
  await sql`UPDATE skus SET item_net_rate=${effective} WHERE id=${skuId}`;
  return { ok: true, skuId, sku_code: skuCode, effective };
}

// ── Party discount % master (versioned; live value stays on customers) ──────
export async function setPartyDisc(opts: {
  customerId?: number; code?: string; discPct: number; effectiveAt?: string; note?: string; actor?: string | null;
}): Promise<{ ok: true; customerId: number; effective: number } | { ok: false; error: string }> {
  const discPct = Number(opts.discPct);
  if (!Number.isFinite(discPct) || discPct < 0 || discPct > 100) return { ok: false, error: "Discount % must be between 0 and 100." };
  await ensurePricingTables();
  const sql = getSql();
  const [cust] = opts.customerId
    ? await sql`SELECT id, code FROM customers WHERE id=${opts.customerId}`
    : await sql`SELECT id, code FROM customers WHERE code=${String(opts.code ?? "").trim()}`;
  if (!cust) return { ok: false, error: `Customer ${opts.code ?? opts.customerId} not found.` };
  const customerId = (cust as { id: number }).id;
  const code = (cust as { code: string }).code;
  await sql`INSERT INTO party_disc_history (customer_id, code, disc_pct, note, created_by)
    VALUES (${customerId}, ${code}, ${discPct}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  await sql`UPDATE customers SET discount_pct=${discPct} WHERE id=${customerId}`;
  return { ok: true, customerId, effective: discPct };
}

// ── Bulk lookup for the sales-order pricing waterfall ───────────────────────
export type SkuPricing = { itemNetRate: number; focPct: number };
export async function getPricingForSkus(skuIds: number[]): Promise<Map<number, SkuPricing>> {
  const out = new Map<number, SkuPricing>();
  if (!skuIds.length) return out;
  await ensurePricingTables();
  const rows = await getSql()`
    SELECT id, COALESCE(item_net_rate,0) AS item_net_rate, COALESCE(foc_pct,0) AS foc_pct
      FROM skus WHERE id = ANY(${skuIds})`;
  for (const r of rows as unknown as { id: number; item_net_rate: number; foc_pct: number }[]) {
    out.set(r.id, { itemNetRate: Number(r.item_net_rate) || 0, focPct: Number(r.foc_pct) || 0 });
  }
  return out;
}
