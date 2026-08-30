import "server-only";
import { getSql } from "./db";
import type { LabelDoc } from "./labelDoc";

// ── Label design storage (draft → approved) ─────────────────────────────────
// Each size has at most one row. `draft_doc` is the work-in-progress; `approved_doc`
// is what actually PRINTS. Printing NEVER reads the draft — so an unapproved design
// (and every currently-locked/approved design) keeps printing exactly as-is until a
// new design is explicitly APPROVED. Approving snapshots the previous approved doc
// into label_design_archive first, so nothing is ever lost.

export type DesignRow = {
  size_id: string; w: number; h: number;
  draft_doc: LabelDoc | null; approved_doc: LabelDoc | null;
  status: "draft" | "approved" | "none";
  updated_by: string | null; updated_at: string | null;
  approved_by: string | null; approved_at: string | null;
};

let ensured: Promise<void> | null = null;
export function ensureDesignTables(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS label_designs (
        size_id text PRIMARY KEY,
        w integer, h integer,
        draft_doc jsonb,
        approved_doc jsonb,
        status text DEFAULT 'none',
        updated_by text,
        updated_at timestamptz DEFAULT now(),
        approved_by text,
        approved_at timestamptz
      )`;
      await sql`CREATE TABLE IF NOT EXISTS label_design_archive (
        id serial PRIMARY KEY,
        size_id text NOT NULL,
        snapshot jsonb NOT NULL,
        reason text,
        archived_by text,
        archived_at timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// jsonb sometimes comes back double-encoded as a string; parse defensively.
function asDoc(v: unknown): LabelDoc | null {
  if (!v) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as LabelDoc; } catch { return null; } }
  return v as LabelDoc;
}

export async function getDesign(sizeId: string): Promise<DesignRow | null> {
  await ensureDesignTables();
  const sql = getSql();
  const [row] = (await sql`SELECT size_id, w, h, draft_doc, approved_doc, status,
      updated_by, to_char(updated_at,'YYYY-MM-DD HH24:MI') AS updated_at,
      approved_by, to_char(approved_at,'YYYY-MM-DD HH24:MI') AS approved_at
    FROM label_designs WHERE size_id=${sizeId}`) as unknown as DesignRow[];
  if (!row) return null;
  return { ...row, draft_doc: asDoc(row.draft_doc), approved_doc: asDoc(row.approved_doc) };
}

export async function listDesigns(): Promise<DesignRow[]> {
  await ensureDesignTables();
  const sql = getSql();
  const rows = (await sql`SELECT size_id, w, h, draft_doc, approved_doc, status,
      updated_by, to_char(updated_at,'YYYY-MM-DD HH24:MI') AS updated_at,
      approved_by, to_char(approved_at,'YYYY-MM-DD HH24:MI') AS approved_at
    FROM label_designs ORDER BY size_id`) as unknown as DesignRow[];
  return rows.map((r) => ({ ...r, draft_doc: asDoc(r.draft_doc), approved_doc: asDoc(r.approved_doc) }));
}

// The doc that PRINTS for this size (approved only) — or null to use the old path.
export async function getApprovedDoc(sizeId: string): Promise<LabelDoc | null> {
  const row = await getDesign(sizeId);
  return row?.approved_doc ?? null;
}

export async function saveDraft(sizeId: string, doc: LabelDoc, actor?: string | null): Promise<void> {
  await ensureDesignTables();
  const sql = getSql();
  await sql`INSERT INTO label_designs (size_id, w, h, draft_doc, status, updated_by, updated_at)
    VALUES (${sizeId}, ${Math.round(doc.w)}, ${Math.round(doc.h)}, ${sql.json(doc as never)},
            (CASE WHEN (SELECT approved_doc FROM label_designs WHERE size_id=${sizeId}) IS NULL THEN 'draft' ELSE 'approved' END),
            ${actor ?? null}, now())
    ON CONFLICT (size_id) DO UPDATE SET
      draft_doc = ${sql.json(doc as never)}, w = ${Math.round(doc.w)}, h = ${Math.round(doc.h)},
      updated_by = ${actor ?? null}, updated_at = now()`;
}

// Promote the draft to the live (printing) design. Archives the previous approved
// doc first. Caller must have already checked the size is not locked.
export async function approveDesign(sizeId: string, actor?: string | null): Promise<{ ok: boolean; error?: string }> {
  await ensureDesignTables();
  const sql = getSql();
  const row = await getDesign(sizeId);
  if (!row || !row.draft_doc) return { ok: false, error: "No draft design to approve." };
  if (row.approved_doc) {
    await sql`INSERT INTO label_design_archive (size_id, snapshot, reason, archived_by)
      VALUES (${sizeId}, ${sql.json(row.approved_doc as never)}, 'superseded by newly approved design', ${actor ?? null})`;
  }
  await sql`UPDATE label_designs SET approved_doc = draft_doc, status = 'approved',
      approved_by = ${actor ?? null}, approved_at = now() WHERE size_id=${sizeId}`;
  return { ok: true };
}

// Discard the draft, reverting it to the currently-approved design (or clearing it).
export async function revertDraft(sizeId: string): Promise<void> {
  await ensureDesignTables();
  const sql = getSql();
  await sql`UPDATE label_designs SET draft_doc = approved_doc, updated_at = now() WHERE size_id=${sizeId}`;
}

// Pull a design (approved preferred) back from the archive is a future feature;
// the archive rows are kept so it can always be restored by hand if needed.
