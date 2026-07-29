import "server-only";
import { getSql } from "./db";

// Per-size label alignment saved by the operator in the visual aligner. Shared
// across all ERP PCs (it's mm-based, so resolution-independent). offsetX/Y nudge
// the whole content block; qrMM overrides the QR size (0 = auto).

export type LabelLayout = { offsetX: number; offsetY: number; qrMM: number };

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
        updated_by text,
        updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export async function getLabelLayouts(): Promise<Record<string, LabelLayout>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT size_id, offset_x, offset_y, qr_mm FROM label_layouts`) as unknown as
      { size_id: string; offset_x: number; offset_y: number; qr_mm: number }[];
    const out: Record<string, LabelLayout> = {};
    for (const r of rows) out[r.size_id] = { offsetX: n(r.offset_x), offsetY: n(r.offset_y), qrMM: n(r.qr_mm) };
    return out;
  } catch { return {}; }
}

export async function saveLabelLayout(sizeId: string, l: LabelLayout, actor?: string | null): Promise<void> {
  await ensure();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
  const ox = clamp(l.offsetX, -30, 30), oy = clamp(l.offsetY, -30, 30), qr = clamp(l.qrMM, 0, 60);
  await getSql()`
    INSERT INTO label_layouts (size_id, offset_x, offset_y, qr_mm, updated_by, updated_at)
    VALUES (${sizeId}, ${ox}, ${oy}, ${qr}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (size_id) DO UPDATE SET offset_x=${ox}, offset_y=${oy}, qr_mm=${qr},
      updated_by=${actor ?? null}, updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}
