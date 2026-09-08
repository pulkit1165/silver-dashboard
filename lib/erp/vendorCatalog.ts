import "server-only";
import { getSql } from "./db";

// ── Vendor catalog (vendor → item → CP) ─────────────────────────────────────
// The foundation for vendor comparison & sourcing. Each vendor uploads the items
// they sell + their cost price (CP). Products are grouped by skus.header (the
// price-list category), so we can compare vendors within a group both ways:
// group → which vendors cover it (and how cheaply), and vendor → what they sell.

let ensured: Promise<void> | null = null;
export function ensureVendorItems(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS vendor_items (
        id serial PRIMARY KEY,
        vendor_id integer NOT NULL,
        sku_id integer NOT NULL,
        cp double precision NOT NULL DEFAULT 0,
        moq double precision DEFAULT 0,
        note text DEFAULT '',
        updated_by text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (vendor_id, sku_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS vendor_items_sku_idx ON vendor_items (sku_id)`;
      await sql`CREATE INDEX IF NOT EXISTS vendor_items_vendor_idx ON vendor_items (vendor_id)`;
      // Optional per-vendor service overrides (lead time / credit days). Auto lead
      // time will be computed from PO→GRN history once that's uploaded.
      await sql.unsafe(`ALTER TABLE vendors
        ADD COLUMN IF NOT EXISTS lead_days integer,
        ADD COLUMN IF NOT EXISTS credit_days integer`);
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// Upsert one vendor's uploaded catalog rows (matched to skus by code).
export async function upsertVendorItems(
  vendorId: number, rows: { sku_code: string; cp: number; moq?: number }[], actor?: string | null,
): Promise<{ upserted: number; unmatched: string[] }> {
  await ensureVendorItems();
  const sql = getSql();
  const codes = [...new Set(rows.map((r) => String(r.sku_code).trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return { upserted: 0, unmatched: [] };
  const skuRows = (await sql`SELECT id, UPPER(sku_code) AS code FROM skus WHERE UPPER(sku_code) = ANY(${codes})`) as unknown as { id: number; code: string }[];
  const idByCode = new Map(skuRows.map((s) => [s.code, s.id]));
  const unmatched: string[] = [];
  let upserted = 0;
  for (const r of rows) {
    const code = String(r.sku_code).trim().toUpperCase();
    const skuId = idByCode.get(code);
    const cp = Number(r.cp);
    if (!skuId) { if (code) unmatched.push(r.sku_code); continue; }
    if (!Number.isFinite(cp) || cp < 0) continue;
    await sql`INSERT INTO vendor_items (vendor_id, sku_id, cp, moq, updated_by)
      VALUES (${vendorId}, ${skuId}, ${cp}, ${Number(r.moq) || 0}, ${actor ?? null})
      ON CONFLICT (vendor_id, sku_id) DO UPDATE SET cp = ${cp}, moq = ${Number(r.moq) || 0}, updated_by = ${actor ?? null}, updated_at = now()`;
    upserted++;
  }
  return { upserted, unmatched: [...new Set(unmatched)] };
}

// ── GROUP → VENDOR comparison ────────────────────────────────────────────────
// For each product group (header): every vendor that carries any item in it,
// how many of the group's items they cover (X of N), and their CP stats.
export interface GroupVendorRow {
  header: string; group_items: number;
  vendor_id: number; vendor_name: string;
  items_covered: number; cp_min: number; cp_avg: number; cp_max: number;
  lead_days: number | null; credit_days: number | null;
}
export async function getGroupVendorMatrix(f: { header?: string } = {}): Promise<GroupVendorRow[]> {
  await ensureVendorItems();
  const sql = getSql();
  const header = f.header?.trim() ? f.header.trim() : null;
  return (await sql`
    WITH grp AS (
      SELECT header, COUNT(*)::int AS group_items
        FROM skus WHERE COALESCE(header,'') <> '' GROUP BY header
    )
    SELECT s.header,
           g.group_items,
           v.id AS vendor_id, COALESCE(v.name,'—') AS vendor_name,
           COUNT(DISTINCT vi.sku_id)::int AS items_covered,
           MIN(vi.cp)::float8 AS cp_min, AVG(vi.cp)::float8 AS cp_avg, MAX(vi.cp)::float8 AS cp_max,
           v.lead_days, v.credit_days
      FROM vendor_items vi
      JOIN skus s ON s.id = vi.sku_id
      JOIN vendors v ON v.id = vi.vendor_id
      JOIN grp g ON g.header = s.header
     WHERE COALESCE(s.header,'') <> ''
       AND (${header}::text IS NULL OR s.header = ${header})
     GROUP BY s.header, g.group_items, v.id, v.name, v.lead_days, v.credit_days
     ORDER BY s.header, items_covered DESC, cp_avg`) as unknown as GroupVendorRow[];
}

// ── VENDOR → GROUP view ──────────────────────────────────────────────────────
export interface VendorGroupRow { vendor_id: number; vendor_name: string; header: string; items_covered: number; group_items: number; cp_avg: number }
export async function getVendorGroupMatrix(vendorId?: number): Promise<VendorGroupRow[]> {
  await ensureVendorItems();
  const sql = getSql();
  return (await sql`
    WITH grp AS (SELECT header, COUNT(*)::int AS group_items FROM skus WHERE COALESCE(header,'')<>'' GROUP BY header)
    SELECT v.id AS vendor_id, COALESCE(v.name,'—') AS vendor_name, s.header,
           COUNT(DISTINCT vi.sku_id)::int AS items_covered, g.group_items, AVG(vi.cp)::float8 AS cp_avg
      FROM vendor_items vi JOIN skus s ON s.id=vi.sku_id JOIN vendors v ON v.id=vi.vendor_id
      JOIN grp g ON g.header = s.header
     WHERE COALESCE(s.header,'')<>'' AND (${vendorId ?? null}::int IS NULL OR v.id = ${vendorId ?? null})
     GROUP BY v.id, v.name, s.header, g.group_items
     ORDER BY v.name, items_covered DESC`) as unknown as VendorGroupRow[];
}

// ── Per-item vendor prices (for the cheapest-source view + cost projection) ──
export interface ItemVendorRow { sku_id: number; sku_code: string; name: string; header: string; vendor_id: number; vendor_name: string; cp: number }
export async function getGroupItemPrices(header: string): Promise<ItemVendorRow[]> {
  await ensureVendorItems();
  const sql = getSql();
  return (await sql`
    SELECT s.id AS sku_id, s.sku_code, s.name, COALESCE(s.header,'') AS header,
           v.id AS vendor_id, COALESCE(v.name,'—') AS vendor_name, vi.cp::float8 AS cp
      FROM vendor_items vi JOIN skus s ON s.id=vi.sku_id JOIN vendors v ON v.id=vi.vendor_id
     WHERE s.header = ${header}
     ORDER BY s.sku_code, vi.cp`) as unknown as ItemVendorRow[];
}

// list of groups that have any vendor pricing, for the picker
export async function getPricedGroups(): Promise<{ header: string; group_items: number; vendors: number; priced_items: number }[]> {
  await ensureVendorItems();
  const sql = getSql();
  // ALL price-list groups (the ~146 headers), whether or not a vendor price list
  // has been uploaded yet — so the optimizer's group picker is populated from the
  // start. vendors/priced_items are 0 until a vendor sheet is uploaded (LEFT JOIN).
  return (await sql`
    SELECT s.header,
           COUNT(DISTINCT s.id)::int         AS group_items,
           COUNT(DISTINCT vi.vendor_id)::int AS vendors,
           COUNT(DISTINCT vi.sku_id)::int    AS priced_items
      FROM skus s
      LEFT JOIN vendor_items vi ON vi.sku_id = s.id
     WHERE COALESCE(s.header,'') <> '' AND s.status <> 'archived'
     GROUP BY s.header ORDER BY s.header`) as unknown as { header: string; group_items: number; vendors: number; priced_items: number }[];
}
