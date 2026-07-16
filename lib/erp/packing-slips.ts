import "server-only";
import { getSql } from "./db";
import { ensureActivityTable } from "./activity";

export interface PackingSlipRow {
  id: number; slip_no: string; so_no: string | null; party: string | null;
  data: unknown; updated_by: string | null; updated_at: string;
}

// One row in the saved-slips archive: the metadata above, plus a few cheap
// fields pulled straight out of the slip's JSON (its own "slip date", how many
// cases/boxes it holds, and whether it's a fully-built slip vs a draft).
export interface PackingSlipListRow {
  id: number; slip_no: string; so_no: string | null; party: string | null;
  updated_by: string | null; updated_at: string;
  slip_date: string | null; box_count: number; is_complete: boolean;
}

export async function listPackingSlips(): Promise<PackingSlipListRow[]> {
  const rows = (await getSql()`
    SELECT id, slip_no, so_no, party, updated_by, updated_at,
           (data->'hdr'->>'date') AS slip_date,
           CASE WHEN jsonb_typeof(data->'completed') = 'array'
                THEN jsonb_array_length(data->'completed') ELSE 0 END AS box_count
    FROM packing_slips ORDER BY updated_at DESC LIMIT 300`) as unknown as
    (Omit<PackingSlipListRow, "is_complete" | "box_count"> & { box_count: number })[];
  // "Fully created" = has a party and at least one closed case (matches the editor's validate()).
  return rows.map((r) => ({
    ...r,
    box_count: Number(r.box_count) || 0,
    is_complete: !!(r.party && r.party.trim()) && (Number(r.box_count) || 0) > 0,
  }));
}

/** Clear the entire Saved Packing Slips archive. Returns how many were removed. */
export async function deleteAllPackingSlips(): Promise<number> {
  const rows = await getSql()`DELETE FROM packing_slips RETURNING id`;
  return (rows as unknown as unknown[]).length;
}

export async function getPackingSlip(idOrNo: string | number): Promise<PackingSlipRow | undefined> {
  const sql = getSql();
  const byId = typeof idOrNo === "number" || /^\d+$/.test(String(idOrNo));
  const [row] = byId
    ? await sql`SELECT * FROM packing_slips WHERE id=${Number(idOrNo)}`
    : await sql`SELECT * FROM packing_slips WHERE slip_no=${String(idOrNo)}`;
  return row as PackingSlipRow | undefined;
}

export async function upsertPackingSlip(input: {
  slipNo: string; soNo?: string | null; party?: string | null; data: unknown; updatedBy?: string | null;
}) {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO packing_slips (slip_no, so_no, party, data, updated_by, updated_at)
    VALUES (${input.slipNo}, ${input.soNo ?? null}, ${input.party ?? null}, ${sql.json(input.data as never)},
            ${input.updatedBy ?? null}, to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS'))
    ON CONFLICT (slip_no) DO UPDATE SET
      so_no=EXCLUDED.so_no, party=EXCLUDED.party, data=EXCLUDED.data,
      updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
    RETURNING id, updated_at`;
  return row as { id: number; updated_at: string };
}

/**
 * Cheap change fingerprint used by the whole-ERP live poller.
 * `z` (activity_log MAX id) is the primary signal — every instrumented write
 * appends there, so any action anywhere bumps it. The per-table maxes/updated_at
 * are kept as a safety net so even un-instrumented writes still push live.
 */
export async function liveFingerprint(): Promise<string> {
  const sql = getSql();
  const [r] = await sql`
    SELECT
      (SELECT COALESCE(MAX(id),0) FROM scan_events) a,
      (SELECT COALESCE(MAX(id),0) FROM stock_moves) b,
      (SELECT COALESCE(MAX(id),0) FROM sales_orders) c,
      (SELECT COALESCE(MAX(id),0) FROM purchase_orders) d,
      (SELECT COALESCE(MAX(id),0) FROM package_lines) e,
      (SELECT COALESCE(MAX(id),0) FROM skus) f,
      (SELECT COALESCE(MAX(id),0) FROM qr_codes) g,
      (SELECT COALESCE(MAX(updated_at),'') FROM packing_slips) h`;
  const x = r as Record<string, string | number>;
  const core = [x.a, x.b, x.c, x.d, x.e, x.f, x.g, x.h].join("-");

  // activity_log is the primary signal (every instrumented write bumps it). Query
  // it separately so a missing table can never break the core live fingerprint.
  let z: string | number = 0;
  try {
    await ensureActivityTable();
    const [a] = await sql`SELECT COALESCE(MAX(id),0) z FROM activity_log`;
    z = (a as { z: string | number }).z;
  } catch { /* fall back to core only */ }

  // Process checklist ticks/edits don't write to activity_log (to keep the feed
  // clean), so fold its own stamp in separately — again guarded so a missing
  // table can never break live sync.
  let cl = "";
  try {
    const [c] = await sql`SELECT COALESCE((SELECT MAX(updated_at) FROM checklist_tasks),'') || COALESCE((SELECT MAX(updated_at) FROM checklist_stages),'') s`;
    cl = (c as { s: string }).s;
  } catch { /* ignore */ }
  return `${z}-${core}-${cl}`;
}
