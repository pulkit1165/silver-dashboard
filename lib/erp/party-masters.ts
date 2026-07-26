import "server-only";
import { getSql } from "./db";
import { ensurePricingTables } from "./pricing-masters";

/**
 * Party-level pricing masters, all on the same append-only recency ledger the
 * item masters use (latest row = live value, mirrored to a fast column so the
 * sales screen reads it cheaply; every prior value is retained for a
 * previous-value column + full history):
 *
 *   party Disc%  -> party_disc_history -> customers.discount_pct
 *   party OGL%   -> party_ogl_history  -> customers.ogl_pct   (extra party discount)
 *   party FOC%   -> party_foc_history  -> customers.foc_pct   (applied LAST, on top)
 *
 * Plus the party × item net-rate matrix (party_item_net_rates): a per-party
 * per-item fixed net rate that is the MOST specific rate — it supersedes the
 * global item net rate for that party. No single mirror column (it's a matrix);
 * the sales order reads the latest rate per (party, item) pair.
 */

// ── Generic party-percent masters (Disc% / OGL% / FOC%) ─────────────────────
export type PartyPctKind = "disc" | "ogl" | "foc";

interface PctCfg { hist: string; col: string; mirror: string; label: string }
const PP: Record<PartyPctKind, PctCfg> = {
  disc: { hist: "party_disc_history", col: "disc_pct", mirror: "discount_pct", label: "Party Discount %" },
  ogl: { hist: "party_ogl_history", col: "ogl_pct", mirror: "ogl_pct", label: "Party OGL %" },
  foc: { hist: "party_foc_history", col: "foc_pct", mirror: "foc_pct", label: "Party FOC %" },
};
export const partyPctCfg = (kind: PartyPctKind) => PP[kind];

export type PartyPctRow = {
  id: number; code: string; name: string; gst: string;
  pct: number; last_pct: number | null; last_at: string | null; last_by: string | null;
  prev_pct: number | null; change_count: number;
};

export async function getCustomersWithPct(kind: PartyPctKind, search?: string, cap = 500): Promise<PartyPctRow[]> {
  await ensurePricingTables();
  const c = PP[kind];
  const like = search && search.trim() ? `%${search.trim()}%` : null;
  const q = `
    SELECT cu.id, cu.code, cu.name, cu.gst, COALESCE(cu.${c.mirror},0) AS pct,
           h.${c.col} AS last_pct, h.effective_at AS last_at, h.created_by AS last_by,
           p.${c.col} AS prev_pct, COALESCE(cc.n,0) AS change_count
      FROM customers cu
      LEFT JOIN LATERAL (SELECT ${c.col}, effective_at, created_by FROM ${c.hist}
                          WHERE customer_id=cu.id ORDER BY effective_at DESC, id DESC LIMIT 1) h ON true
      LEFT JOIN LATERAL (SELECT ${c.col} FROM ${c.hist}
                          WHERE customer_id=cu.id ORDER BY effective_at DESC, id DESC OFFSET 1 LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM ${c.hist} WHERE customer_id=cu.id) cc ON true
     WHERE ($1::text IS NULL OR cu.code ILIKE $1 OR cu.name ILIKE $1 OR cu.gst ILIKE $1)
     ORDER BY cu.name LIMIT ${Number(cap)}`;
  return (await getSql().unsafe(q, [like])) as unknown as PartyPctRow[];
}

export type PartyPctHistoryRow = { id: number; pct: number; effective_at: string; note: string; created_by: string; created_at: string };
export async function getPartyPctHistory(kind: PartyPctKind, customerId: number): Promise<PartyPctHistoryRow[]> {
  await ensurePricingTables();
  const c = PP[kind];
  const q = `SELECT id, ${c.col} AS pct, effective_at, note, created_by, created_at
               FROM ${c.hist} WHERE customer_id=$1 ORDER BY effective_at DESC, id DESC LIMIT 100`;
  return (await getSql().unsafe(q, [customerId])) as unknown as PartyPctHistoryRow[];
}

export type SetPctResult = { ok: true; customerId: number; code: string; effective: number } | { ok: false; error: string };

const normEff = (e?: string) =>
  e && /^\d{4}-\d{2}-\d{2}/.test(e) ? (e.length <= 10 ? `${e} 00:00:00` : e) : null;

export async function setPartyPct(kind: PartyPctKind, opts: {
  customerId?: number; code?: string; pct: number; effectiveAt?: string; note?: string; actor?: string | null;
}): Promise<SetPctResult> {
  const pct = Number(opts.pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: "Percentage must be between 0 and 100." };
  await ensurePricingTables();
  const c = PP[kind];
  const sql = getSql();
  const [cust] = opts.customerId
    ? await sql`SELECT id, code FROM customers WHERE id=${opts.customerId}`
    : await sql`SELECT id, code FROM customers WHERE code=${String(opts.code ?? "").trim()}`;
  if (!cust) return { ok: false, error: `Customer ${opts.code ?? opts.customerId} not found.` };
  const customerId = (cust as { id: number }).id;
  const code = (cust as { code: string }).code;
  const effAt = normEff(opts.effectiveAt);
  await sql.unsafe(
    `INSERT INTO ${c.hist} (customer_id, code, ${c.col}, ${effAt ? "effective_at, " : ""}note, created_by)
     VALUES ($1, $2, $3, ${effAt ? "$4, $5, $6" : "$4, $5"})`,
    effAt ? [customerId, code, pct, effAt, opts.note ?? "", opts.actor ?? null]
          : [customerId, code, pct, opts.note ?? "", opts.actor ?? null],
  );
  await sql.unsafe(`UPDATE customers SET ${c.mirror}=$1 WHERE id=$2`, [pct, customerId]);
  return { ok: true, customerId, code, effective: pct };
}

// ── Party × item net rate matrix ────────────────────────────────────────────
export type PartyItemRow = {
  customer_id: number; party_code: string; party: string;
  sku_id: number; sku_code: string; item: string; category: string; mrp: number;
  net_rate: number; last_at: string | null; last_by: string | null;
  prev_rate: number | null; change_count: number;
};

export async function getPartyItemRates(opts: { partyId?: number; itemSearch?: string; cap?: number }): Promise<PartyItemRow[]> {
  await ensurePricingTables();
  const cap = Number(opts.cap ?? 500);
  const pid = opts.partyId ?? null;
  const like = opts.itemSearch && opts.itemSearch.trim() ? `%${opts.itemSearch.trim()}%` : null;
  const q = `
    WITH latest AS (
      SELECT DISTINCT ON (r.customer_id, r.sku_id)
             r.customer_id, r.sku_id, r.net_rate, r.effective_at, r.created_by
        FROM party_item_net_rates r
       WHERE ($1::int IS NULL OR r.customer_id = $1)
       ORDER BY r.customer_id, r.sku_id, r.effective_at DESC, r.id DESC
    )
    SELECT l.customer_id, cu.code AS party_code, cu.name AS party,
           l.sku_id, s.sku_code, s.name AS item, COALESCE(s.category,'') AS category, COALESCE(s.price,0) AS mrp,
           l.net_rate, l.effective_at AS last_at, l.created_by AS last_by,
           pv.net_rate AS prev_rate, COALESCE(cnt.n,0) AS change_count
      FROM latest l
      JOIN customers cu ON cu.id=l.customer_id
      JOIN skus s ON s.id=l.sku_id
      LEFT JOIN LATERAL (SELECT net_rate FROM party_item_net_rates
                          WHERE customer_id=l.customer_id AND sku_id=l.sku_id
                          ORDER BY effective_at DESC, id DESC OFFSET 1 LIMIT 1) pv ON true
      LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM party_item_net_rates
                          WHERE customer_id=l.customer_id AND sku_id=l.sku_id) cnt ON true
     WHERE ($2::text IS NULL OR s.sku_code ILIKE $2 OR s.name ILIKE $2)
     ORDER BY cu.name, s.sku_code
     LIMIT ${cap}`;
  return (await getSql().unsafe(q, [pid, like])) as unknown as PartyItemRow[];
}

/** Latest net rate per SKU for one customer — the sales-order pricing lookup. */
export async function getPartyItemRatesForCustomer(customerId: number): Promise<Map<number, number>> {
  await ensurePricingTables();
  const rows = await getSql()`
    SELECT DISTINCT ON (sku_id) sku_id, net_rate
      FROM party_item_net_rates WHERE customer_id=${customerId}
     ORDER BY sku_id, effective_at DESC, id DESC`;
  const m = new Map<number, number>();
  for (const r of rows as unknown as { sku_id: number; net_rate: number }[]) m.set(r.sku_id, Number(r.net_rate) || 0);
  return m;
}

export type PartyItemHistoryRow = { id: number; net_rate: number; effective_at: string; note: string; created_by: string };
export async function getPartyItemHistory(customerId: number, skuId: number): Promise<PartyItemHistoryRow[]> {
  await ensurePricingTables();
  return (await getSql()`
    SELECT id, net_rate, effective_at, note, created_by FROM party_item_net_rates
     WHERE customer_id=${customerId} AND sku_id=${skuId} ORDER BY effective_at DESC, id DESC LIMIT 100`) as unknown as PartyItemHistoryRow[];
}

export type SetPartyItemResult = { ok: true; customerId: number; skuId: number; net_rate: number } | { ok: false; error: string };
export async function setPartyItemNetRate(opts: {
  customerId?: number; partyCode?: string; skuId?: number; skuCode?: string;
  netRate: number; effectiveAt?: string; note?: string; actor?: string | null;
}): Promise<SetPartyItemResult> {
  const netRate = Number(opts.netRate);
  if (!Number.isFinite(netRate) || netRate < 0) return { ok: false, error: "Net rate must be a non-negative number." };
  await ensurePricingTables();
  const sql = getSql();
  const [cust] = opts.customerId
    ? await sql`SELECT id, code FROM customers WHERE id=${opts.customerId}`
    : await sql`SELECT id, code FROM customers WHERE code=${String(opts.partyCode ?? "").trim()}`;
  if (!cust) return { ok: false, error: `Customer ${opts.partyCode ?? opts.customerId} not found.` };
  const [sku] = opts.skuId
    ? await sql`SELECT id, sku_code FROM skus WHERE id=${opts.skuId}`
    : await sql`SELECT id, sku_code FROM skus WHERE sku_code=${String(opts.skuCode ?? "").trim()}`;
  if (!sku) return { ok: false, error: `Item ${opts.skuCode ?? opts.skuId} not found.` };
  const customerId = (cust as { id: number }).id;
  const code = (cust as { code: string }).code;
  const skuId = (sku as { id: number }).id;
  const skuCode = (sku as { sku_code: string }).sku_code;
  const effAt = normEff(opts.effectiveAt);
  if (effAt) {
    await sql`INSERT INTO party_item_net_rates (customer_id, code, sku_id, sku_code, net_rate, effective_at, note, created_by)
      VALUES (${customerId}, ${code}, ${skuId}, ${skuCode}, ${netRate}, ${effAt}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  } else {
    await sql`INSERT INTO party_item_net_rates (customer_id, code, sku_id, sku_code, net_rate, note, created_by)
      VALUES (${customerId}, ${code}, ${skuId}, ${skuCode}, ${netRate}, ${opts.note ?? ""}, ${opts.actor ?? null})`;
  }
  return { ok: true, customerId, skuId, net_rate: netRate };
}

/** Bulk load the party × item net-rate sheet: [{party, sku_code, net_rate}]. */
export async function applyPartyItemBulk(
  updates: Array<{ party?: string; party_code?: string; sku_code?: string; net_rate: number }>,
  effectiveAt: string | undefined, note: string | undefined, actor: string | null,
): Promise<{ applied: number; failed: number; errors: string[] }> {
  await ensurePricingTables();
  const sql = getSql();
  // Resolve parties (by code, then by exact name, case-insensitive) and skus once.
  const custRows = (await sql`SELECT id, code, name FROM customers`) as unknown as { id: number; code: string | null; name: string | null }[];
  const byCode = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of custRows) {
    if (r.code) byCode.set(r.code.trim().toUpperCase(), r.id);
    if (r.name) byName.set(r.name.trim().toUpperCase(), r.id);
  }
  const skuRows = (await sql`SELECT id, sku_code FROM skus`) as unknown as { id: number; sku_code: string }[];
  const skuByCode = new Map<string, { id: number; code: string }>();
  for (const r of skuRows) skuByCode.set(r.sku_code.trim().toUpperCase(), { id: r.id, code: r.sku_code });

  const effAt = normEff(effectiveAt);
  let applied = 0;
  const errors: string[] = [];
  for (const u of updates) {
    const partyRaw = String(u.party_code ?? u.party ?? "").trim();
    const skuRaw = String(u.sku_code ?? "").trim().toUpperCase();
    const netRate = Number(u.net_rate);
    if (!partyRaw) { errors.push("Row missing party"); continue; }
    if (!skuRaw) { errors.push(`${partyRaw}: missing item code`); continue; }
    if (!Number.isFinite(netRate) || netRate < 0) { errors.push(`${partyRaw}/${skuRaw}: invalid net rate`); continue; }
    const cid = byCode.get(partyRaw.toUpperCase()) ?? byName.get(partyRaw.toUpperCase());
    if (cid == null) { errors.push(`Party not found: ${partyRaw}`); continue; }
    const sku = skuByCode.get(skuRaw);
    if (!sku) { errors.push(`Item not found: ${skuRaw}`); continue; }
    const code = custRows.find((c) => c.id === cid)?.code ?? "";
    try {
      if (effAt) {
        await sql`INSERT INTO party_item_net_rates (customer_id, code, sku_id, sku_code, net_rate, effective_at, note, created_by)
          VALUES (${cid}, ${code}, ${sku.id}, ${sku.code}, ${netRate}, ${effAt}, ${note ?? ""}, ${actor})`;
      } else {
        await sql`INSERT INTO party_item_net_rates (customer_id, code, sku_id, sku_code, net_rate, note, created_by)
          VALUES (${cid}, ${code}, ${sku.id}, ${sku.code}, ${netRate}, ${note ?? ""}, ${actor})`;
      }
      applied++;
    } catch (e) {
      errors.push(`${partyRaw}/${skuRaw}: ${(e as Error).message}`);
    }
  }
  return { applied, failed: errors.length, errors: errors.slice(0, 50) };
}
