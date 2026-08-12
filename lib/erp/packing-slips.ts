import "server-only";
import { getSql } from "./db";
import { nextPackingSlipNo } from "./queries";
import { ensureActivityTable } from "./activity";
import { ensureChecklistTables } from "./checklist";

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

export type UpsertSlipResult =
  | { ok: true; id: number; slipNo: string; updated_at: string }
  | { ok: false; conflict: true; error: string }
  | { ok: false; error: string };

export async function upsertPackingSlip(input: {
  id?: number | null; create?: boolean;
  slipNo: string; soNo?: string | null; party?: string | null; data: unknown;
  updatedBy?: string | null; expectedUpdatedAt?: string | null;
}): Promise<UpsertSlipResult> {
  const sql = getSql();

  // EDIT an EXISTING slip (client already holds its id) → UPDATE by id, guarded by an
  // optimistic lock so we never silently blow away a change someone else saved in the
  // meantime. This replaces the old blind "ON CONFLICT (slip_no) DO UPDATE", which both
  // clobbered other users' slips (same number) AND lost concurrent edits of the same slip.
  if (input.id) {
    let rows: Array<{ id: number; slip_no: string; updated_at: string }>;
    try {
      rows = (input.expectedUpdatedAt
        ? await sql`
            UPDATE packing_slips SET slip_no=${input.slipNo}, so_no=${input.soNo ?? null}, party=${input.party ?? null},
              data=${sql.json(input.data as never)}, updated_by=${input.updatedBy ?? null},
              updated_at=to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS')
            WHERE id=${input.id} AND updated_at=${input.expectedUpdatedAt}
            RETURNING id, slip_no, updated_at`
        : await sql`
            UPDATE packing_slips SET slip_no=${input.slipNo}, so_no=${input.soNo ?? null}, party=${input.party ?? null},
              data=${sql.json(input.data as never)}, updated_by=${input.updatedBy ?? null},
              updated_at=to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS')
            WHERE id=${input.id}
            RETURNING id, slip_no, updated_at`) as unknown as typeof rows;
    } catch {
      // unique violation: the slip_no now belongs to a DIFFERENT slip
      return { ok: false, error: `Slip number ${input.slipNo} is already used by another slip.` };
    }
    if (rows[0]) return { ok: true, id: rows[0].id, slipNo: rows[0].slip_no, updated_at: rows[0].updated_at };
    // Nothing updated: either the id is gone, or (with a guard) someone else saved first.
    const [exists] = (await sql`SELECT 1 AS x FROM packing_slips WHERE id=${input.id}`) as unknown as Array<{ x: number }>;
    if (exists) return { ok: false, conflict: true, error: "This slip was changed by someone else — reload it to see their changes, then save again." };
    // id vanished (deleted) → fall through and re-create it as a new slip.
  }

  // Backward-compat: an OLD client tab (open across a deploy) sends neither id nor the
  // `create` flag. Treat that as the legacy upsert-by-slip_no so it keeps updating its own
  // slip instead of spawning a duplicate every autosave. New clients always send `create`
  // for a brand-new slip (below) or `id` for an edit (above), so they use the safe paths.
  if (!input.create) {
    const rows = (await sql`
      INSERT INTO packing_slips (slip_no, so_no, party, data, updated_by, updated_at)
      VALUES (${input.slipNo}, ${input.soNo ?? null}, ${input.party ?? null}, ${sql.json(input.data as never)},
              ${input.updatedBy ?? null}, to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS'))
      ON CONFLICT (slip_no) DO UPDATE SET so_no=EXCLUDED.so_no, party=EXCLUDED.party, data=EXCLUDED.data,
        updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
      RETURNING id, slip_no, updated_at`) as unknown as Array<{ id: number; slip_no: string; updated_at: string }>;
    if (rows[0]) return { ok: true, id: rows[0].id, slipNo: rows[0].slip_no, updated_at: rows[0].updated_at };
  }

  // NEW slip (create) → collision-safe INSERT. If the number is already taken (another user
  // grabbed it in the gap between next-no and save), reassign the next free number and retry,
  // so two slips can NEVER collide and no one's slip is ever overwritten.
  const prefix = /^(.*)\/\d+$/.exec(input.slipNo)?.[1] || "PS26";
  let no = input.slipNo || `${prefix}/0001`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = (await sql`
      INSERT INTO packing_slips (slip_no, so_no, party, data, updated_by, updated_at)
      VALUES (${no}, ${input.soNo ?? null}, ${input.party ?? null}, ${sql.json(input.data as never)},
              ${input.updatedBy ?? null}, to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS'))
      ON CONFLICT (slip_no) DO NOTHING
      RETURNING id, slip_no, updated_at`) as unknown as Array<{ id: number; slip_no: string; updated_at: string }>;
    if (rows[0]) return { ok: true, id: rows[0].id, slipNo: rows[0].slip_no, updated_at: rows[0].updated_at };
    no = await nextPackingSlipNo(prefix); // taken → next free number, retry
  }
  return { ok: false, error: "Could not allocate a free slip number — please retry." };
}

/**
 * Cheap change fingerprint used by the whole-ERP live poller.
 * `z` (activity_log MAX id) is the primary signal — every instrumented write
 * appends there, so any action anywhere bumps it. The per-table maxes/updated_at
 * are kept as a safety net so even un-instrumented writes still push live.
 */
export async function liveFingerprint(): Promise<string> {
  const sql = getSql();
  // This runs on every client's ~5s poll, so it must be ONE DB round-trip.
  // activity_log + checklist tables are optional (self-create), so we ensure
  // they exist first (cached no-ops) and then read everything in a single query.
  // If ensuring/reading the optional tables ever fails, fall back to a core-only
  // single query so live sync can never break.
  try {
    await ensureActivityTable();
    await ensureChecklistTables();
    const [r] = await sql`
      SELECT
        (SELECT COALESCE(MAX(id),0) FROM scan_events) a,
        (SELECT COALESCE(MAX(id),0) FROM stock_moves) b,
        (SELECT COALESCE(MAX(id),0) FROM sales_orders) c,
        (SELECT COALESCE(MAX(id),0) FROM purchase_orders) d,
        (SELECT COALESCE(MAX(id),0) FROM package_lines) e,
        (SELECT COALESCE(MAX(id),0) FROM skus) f,
        (SELECT COALESCE(MAX(id),0) FROM qr_codes) g,
        (SELECT COALESCE(MAX(updated_at),'') FROM packing_slips) h,
        (SELECT COALESCE(MAX(id),0) FROM activity_log) z,
        (SELECT COALESCE(MAX(updated_at),'') FROM checklist_tasks) i,
        (SELECT COALESCE(MAX(updated_at),'') FROM checklist_stages) j`;
    const x = r as Record<string, string | number>;
    return `${x.z}-${x.a}-${x.b}-${x.c}-${x.d}-${x.e}-${x.f}-${x.g}-${x.h}-${x.i}${x.j}`;
  } catch {
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
    return `${x.a}-${x.b}-${x.c}-${x.d}-${x.e}-${x.f}-${x.g}-${x.h}`;
  }
}
