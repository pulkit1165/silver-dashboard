import "server-only";
import { getSql, getRawSql } from "./db";

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
     ORDER BY (COALESCE(s.price, 0) > 0) DESC, s.sku_code
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

// ── Pull MRPs from Oracle (A_LABELPRINT) ────────────────────────────────────
// The authoritative MRP per item code, latest per code. Read-only source.
export async function getOracleMrpByCode(): Promise<Map<string, number>> {
  try {
    const db = getRawSql();
    const rows = (await db`
      SELECT DISTINCT ON (UPPER(data->>'ITEMCODE')) UPPER(data->>'ITEMCODE') AS code, (data->>'MRP')::numeric AS mrp
        FROM oracle_raw
       WHERE source_table = 'A_LABELPRINT' AND data->>'MRP' ~ '^[0-9.]+$'
       ORDER BY UPPER(data->>'ITEMCODE'), (data->>'RN')::numeric DESC`) as unknown as { code: string; mrp: number }[];
    const m = new Map<string, number>();
    for (const r of rows) { const v = Number(r.mrp); if (v > 0) m.set(String(r.code), v); }
    return m;
  } catch { return new Map(); }
}

const todayTs = () => `${new Date().toISOString().slice(0, 10)} 00:00:00`;

// Fill SKU MRPs from Oracle. onlyMissing=true keeps any MRP already set (only
// fills 0s). Each change appends a dated mrp_history row and syncs skus.price
// (so it flows to labels/orders) — old values are retained.
export async function syncMrpFromOracle(opts: {
  actor?: string | null; onlyMissing?: boolean; effectiveAt?: string;
}): Promise<{ updated: number; matched: number; oracleItems: number }> {
  await ensureMrpTable();
  const sql = getSql();
  const oracleMrp = await getOracleMrpByCode();
  if (oracleMrp.size === 0) return { updated: 0, matched: 0, oracleItems: 0 };

  const skus = (await sql`SELECT id, sku_code, COALESCE(price, 0)::float8 AS price FROM skus`) as unknown as
    { id: number; sku_code: string; price: number }[];
  const effAt = opts.effectiveAt && /^\d{4}-\d{2}-\d{2}/.test(opts.effectiveAt)
    ? (opts.effectiveAt.length <= 10 ? `${opts.effectiveAt} 00:00:00` : opts.effectiveAt) : todayTs();

  let matched = 0;
  const toSet: { id: number; code: string; mrp: number }[] = [];
  for (const s of skus) {
    const mrp = oracleMrp.get(String(s.sku_code).toUpperCase());
    if (mrp == null) continue;
    matched++;
    if (opts.onlyMissing && Number(s.price) > 0) continue; // keep existing
    if (Number(s.price) === mrp) continue;                  // no change
    toSet.push({ id: s.id, code: s.sku_code, mrp });
  }

  const CHUNK = 500;
  for (let i = 0; i < toSet.length; i += CHUNK) {
    const chunk = toSet.slice(i, i + CHUNK);
    const histRows = chunk.map((r) => ({ sku_id: r.id, sku_code: r.code, mrp: r.mrp, effective_at: effAt, note: "Synced from Oracle", created_by: opts.actor ?? null }));
    await sql`INSERT INTO mrp_history ${sql(histRows, "sku_id", "sku_code", "mrp", "effective_at", "note", "created_by")}`;
    await sql`UPDATE skus AS s SET price = v.mrp::float8
                FROM (VALUES ${sql(chunk.map((r) => [r.id, r.mrp]))}) AS v(id, mrp)
               WHERE s.id = v.id::int`;
  }
  return { updated: toSet.length, matched, oracleItems: oracleMrp.size };
}
