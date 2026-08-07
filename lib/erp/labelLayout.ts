import "server-only";
import { getSql } from "./db";

// Per-size label alignment saved by the operator in the visual aligner. Shared
// across all ERP PCs (it's mm-based, so resolution-independent). offsetX/Y nudge
// the whole content block; qrMM overrides the QR size (0 = auto). `elements` holds
// per-attribute overrides (qr|code|name|qty|mrp → dx/dy mm, f = font, sz = QR mm).

export type ElOverride = { dx?: number; dy?: number; f?: number; sz?: number; b?: number; mm?: number };
export type LabelLayout = { offsetX: number; offsetY: number; qrMM: number; elements?: Record<string, ElOverride> };

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS label_layouts (
        size_id text PRIMARY KEY,
        offset_x double precision DEFAULT 0,
        offset_y double precision DEFAULT 0,
        qr_mm double precision DEFAULT 0,
        elements jsonb,
        updated_by text,
        updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
      // Add the column on pre-existing tables (feature shipped after the table).
      await sql`ALTER TABLE label_layouts ADD COLUMN IF NOT EXISTS elements jsonb`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

// Keep only known keys, coerce to numbers, drop empties so the JSON stays small.
const EL_KEYS = ["qr", "code", "name", "qty", "mrp", "extras"] as const;
function cleanElements(raw: unknown): Record<string, ElOverride> | undefined {
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
    const rows = (await getSql()`SELECT size_id, offset_x, offset_y, qr_mm, elements FROM label_layouts`) as unknown as
      { size_id: string; offset_x: number; offset_y: number; qr_mm: number; elements: unknown }[];
    const out: Record<string, LabelLayout> = {};
    for (const r of rows) out[r.size_id] = { offsetX: n(r.offset_x), offsetY: n(r.offset_y), qrMM: n(r.qr_mm), elements: cleanElements(r.elements) };
    return out;
  } catch { return {}; }
}

export async function saveLabelLayout(sizeId: string, l: LabelLayout, actor?: string | null): Promise<void> {
  await ensure();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
  const ox = clamp(l.offsetX, -30, 30), oy = clamp(l.offsetY, -30, 30), qr = clamp(l.qrMM, 0, 60);
  const els = cleanElements(l.elements);
  const elsJson = els ? JSON.stringify(els) : null;
  await getSql()`
    INSERT INTO label_layouts (size_id, offset_x, offset_y, qr_mm, elements, updated_by, updated_at)
    VALUES (${sizeId}, ${ox}, ${oy}, ${qr}, ${elsJson}::jsonb, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (size_id) DO UPDATE SET offset_x=${ox}, offset_y=${oy}, qr_mm=${qr}, elements=${elsJson}::jsonb,
      updated_by=${actor ?? null}, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}

// Wipe all saved alignments so every size falls back to its built-in (current) layout.
export async function clearAllLayouts(): Promise<number> {
  await ensure();
  const rows = (await getSql()`DELETE FROM label_layouts RETURNING size_id`) as unknown as { size_id: string }[];
  return rows.length;
}
