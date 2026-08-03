import "server-only";
import { getSql } from "./db";

// Per-SKU label name override. Lets the operator set the product name AS IT SHOULD
// PRINT — including manual line breaks (newlines) so they control where it wraps.
// Shared across all ERP PCs; used for every size of that part.

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS label_names (
        sku_code text PRIMARY KEY,
        name text NOT NULL,
        updated_by text,
        updated_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function getLabelNames(): Promise<Record<string, string>> {
  try {
    await ensure();
    const rows = (await getSql()`SELECT sku_code, name FROM label_names`) as unknown as { sku_code: string; name: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.sku_code] = r.name;
    return out;
  } catch { return {}; }
}

export async function saveLabelName(skuCode: string, name: string, actor?: string | null): Promise<void> {
  await ensure();
  // keep at most 3 non-empty lines, trim each, cap length
  const clean = String(name ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 3).join("\n").slice(0, 120);
  if (!clean) { // empty → clear the override (fall back to the SKU's real name)
    await getSql()`DELETE FROM label_names WHERE sku_code=${skuCode}`;
    return;
  }
  await getSql()`
    INSERT INTO label_names (sku_code, name, updated_by, updated_at)
    VALUES (${skuCode}, ${clean}, ${actor ?? null}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (sku_code) DO UPDATE SET name=${clean}, updated_by=${actor ?? null},
      updated_at=to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`;
}
