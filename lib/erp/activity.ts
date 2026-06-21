import "server-only";
import { getSql } from "./db";

/**
 * Org-wide activity / audit feed.
 *
 * Every meaningful write in the ERP appends one row here, and the live-sync
 * fingerprint (lib/erp/packing-slips.ts → liveFingerprint) watches MAX(id) of
 * this table — so any action, by anyone, in any module, pushes to every signed-in
 * device within ~2.5s. It is also a permanent who-did-what-when audit trail.
 *
 * The table self-creates on first use (idempotent, mirrors lib/erp/schema.ts
 * `activityLog`) so production migrates itself with its own connection.
 */

let ensured: Promise<void> | null = null;
export function ensureActivityTable(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS activity_log (
        id serial PRIMARY KEY,
        actor text,
        actor_role text,
        action text NOT NULL,
        entity text,
        entity_id text,
        summary text,
        meta jsonb,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
      await sql`CREATE INDEX IF NOT EXISTS activity_id_idx ON activity_log (id)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export type ActivityInput = {
  actor?: string | null;
  actorRole?: string | null;
  action: string;                 // machine key, e.g. "scan.dispatch", "invoice.create"
  entity?: string | null;         // e.g. "sales_order", "sku", "invoice"
  entityId?: string | number | null;
  summary?: string | null;        // human one-liner shown in the feed
  meta?: unknown;                 // optional structured detail
};

/** Best-effort: auditing must never break the underlying operation. */
export async function logActivity(a: ActivityInput): Promise<void> {
  try {
    await ensureActivityTable();
    const sql = getSql();
    await sql`
      INSERT INTO activity_log (actor, actor_role, action, entity, entity_id, summary, meta)
      VALUES (${a.actor ?? null}, ${a.actorRole ?? null}, ${a.action}, ${a.entity ?? null},
              ${a.entityId != null ? String(a.entityId) : null}, ${a.summary ?? null},
              ${a.meta != null ? sql.json(a.meta as never) : null})`;
  } catch { /* swallow */ }
}

export interface ActivityRow {
  id: number; actor: string | null; actor_role: string | null; action: string;
  entity: string | null; entity_id: string | null; summary: string | null;
  meta: unknown; created_at: string;
}
export async function listActivity(limit = 150): Promise<ActivityRow[]> {
  try {
    await ensureActivityTable();
    return (await getSql()`
      SELECT id, actor, actor_role, action, entity, entity_id, summary, meta, created_at
      FROM activity_log ORDER BY id DESC LIMIT ${limit}`) as unknown as ActivityRow[];
  } catch { return []; }
}
