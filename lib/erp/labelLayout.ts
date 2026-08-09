import "server-only";
import { getSql } from "./db";

// Per-size label alignment saved by the operator in the visual aligner. Shared
// across all ERP PCs (it's mm-based, so resolution-independent). offsetX/Y nudge
// the whole content block; qrMM overrides the QR size (0 = auto). `elements` holds
// per-attribute overrides (qr|code|name|qty|mrp → dx/dy mm, f = font, sz = QR mm).

export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number; b?: number; mm?: number };
export type LabelLayout = { offsetX: number; offsetY: number; qrMM: number; elements?: Record<string, ElOverride>; design?: number };

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      // These are all idempotent DDL, but CREATE/ALTER ... IF NOT EXISTS can still
      // spuriously error when several requests run them at once (Postgres column-
      // collision race). Swallow those so ensure() never throws for an already-set-up
      // table — otherwise getLabelLayouts would catch, return {}, and EVERY label
      // would print with no saved layout (untuned).
      try {
        await sql`CREATE TABLE IF NOT EXISTS label_layouts (
          size_id text PRIMARY KEY,
          offset_x double precision DEFAULT 0,
          offset_y double precision DEFAULT 0,
          qr_mm double precision DEFAULT 0,
          elements jsonb,
          updated_by text,
          updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        )`;
      } catch { /* concurrent create */ }
      try { await sql`ALTER TABLE label_layouts ADD COLUMN IF NOT EXISTS elements jsonb`; } catch { /* concurrent/exists */ }
      try { await sql`ALTER TABLE label_layouts ADD COLUMN IF NOT EXISTS design integer DEFAULT 1`; } catch { /* concurrent/exists */ }
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

// Keep only known keys, coerce to numbers, drop empties so the JSON stays small.
const EL_KEYS = ["qr", "code", "name", "qty", "mrp", "extras"] as const;
function cleanElements(raw: unknown): Record<string, ElOverride> | undefined {
  // Safety net: tolerate a jsonb value that came back as a JSON STRING (double-encoded
  // by an older write) so a bad row can never silently drop a size's whole layout.
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return undefined; } }
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, ElOverride>;
  const out: Record<string, ElOverride> = {};
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
  for (const k of EL_KEYS) {
    const e = src[k]; if (!e || typeof e !== "object") continue;
    const dx = cl(n(e.dx), -40, 40), dy = cl(n(e.dy), -40, 40);
    const f = Math.round(cl(n(e.f), 0, 7));
    const sz = cl(n(e.sz), 0, 60);
    const mm = Math.round(cl(n(e.mm), 0, 20) * 10) / 10;
    const b = e.b ? 1 : 0;
    if (dx || dy || f || sz || b || mm) out[k] = { ...(dx ? { dx } : {}), ...(dy ? { dy } : {}), ...(f ? { f } : {}), ...(sz ? { sz } : {}), ...(mm ? { mm } : {}), ...(b ? { b } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

export async function getLabelLayouts(): Promise<Record<string, LabelLayout>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT size_id, offset_x, offset_y, qr_mm, elements, design FROM label_layouts`) as unknown as
      { size_id: string; offset_x: number; offset_y: number; qr_mm: number; elements: unknown; design: number }[];
    const out: Record<string, LabelLayout> = {};
    for (const r of rows) out[r.size_id] = { offsetX: n(r.offset_x), offsetY: n(r.offset_y), qrMM: n(r.qr_mm), elements: cleanElements(r.elements), design: n(r.design) === 2 ? 2 : 1 };
    return out;
  } catch { return {}; }
}

export async function saveLabelLayout(sizeId: string, l: LabelLayout, actor?: string | null): Promise<void> {
  await ensure();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
  const ox = clamp(l.offsetX, -30, 30), oy = clamp(l.offsetY, -30, 30), qr = clamp(l.qrMM, 0, 60);
  const els = cleanElements(l.elements);
  // Store as a real jsonb OBJECT via sql.json(). (Previously `${JSON.stringify(els)}::jsonb`
  // double-encoded it into a jsonb STRING, which the loader couldn't read → the size's
  // whole layout silently vanished.)
  const sql = getSql();
  const elsVal = els ? sql.json(els as never) : null;
  // design: explicit 1/2 sets it; undefined PRESERVES the existing choice (so the
  // aligner saving offsets never resets which template the size is on).
  const design = l.design === 2 ? 2 : l.design === 1 ? 1 : null;
  await sql`
    INSERT INTO label_layouts (size_id, offset_x, offset_y, qr_mm, elements, design, updated_by, updated_at)
    VALUES (${sizeId}, ${ox}, ${oy}, ${qr}, ${elsVal}, ${design ?? 1}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (size_id) DO UPDATE SET offset_x=${ox}, offset_y=${oy}, qr_mm=${qr}, elements=${elsVal},
      design=COALESCE(${design}, label_layouts.design),
      updated_by=${actor ?? null}, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}

// Wipe all saved alignments so every size falls back to its built-in (current) layout.
// DESTRUCTIVE: erases every operator's saved alignment. Guarded so it can only run
// when a caller explicitly opts in — no accidental/automated wipe can ever fire.
export async function clearAllLayouts(confirm?: "WIPE-ALL-LABEL-LAYOUTS"): Promise<number> {
  if (confirm !== "WIPE-ALL-LABEL-LAYOUTS") {
    throw new Error("clearAllLayouts refused: pass the explicit confirm token to wipe all saved alignments.");
  }
  await ensure();
  const rows = (await getSql()`DELETE FROM label_layouts RETURNING size_id`) as unknown as { size_id: string }[];
  return rows.length;
}
