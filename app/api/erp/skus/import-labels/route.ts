import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { norm, pick, num } from "@/lib/erp/skuImport";

export const dynamic = "force-dynamic";

// Backfill-only: updates barcode_code / master_qty on SKUs that already exist
// (matched by sku_code). Unlike /api/erp/skus/import, this never creates rows —
// every row must match an existing SKU, and a row with only one of the two
// fields leaves the other field untouched.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit SKUs.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = Boolean(body.dryRun);
  if (rows.length === 0) return NextResponse.json({ ok: false, error: "No rows provided." }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ ok: false, error: "Max 5000 rows per import." }, { status: 400 });

  const sql = getSql();
  const existingRows = (await sql`SELECT id, sku_code FROM skus`) as unknown as { id: number; sku_code: string }[];
  const bySkuCode = new Map(existingRows.map((r) => [r.sku_code.toUpperCase(), r.id]));
  const seenInFile = new Set<string>();

  const errors: { row: number; sku_code: string; reason: string }[] = [];
  const valid: { sku_id: number; sku_code: string; barcode_code?: string; master_qty?: number }[] = [];

  rows.forEach((raw, i) => {
    const rn: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) rn[norm(k)] = v == null ? "" : String(v).trim();
    const sku_code = pick(rn, "sku_code").trim().toUpperCase();
    const barcode = pick(rn, "barcode_code").trim();
    const masterRaw = pick(rn, "master_qty").trim();
    if (!sku_code && !barcode && !masterRaw) return; // blank line — skip silently
    if (!sku_code) { errors.push({ row: i + 1, sku_code: "", reason: "Missing SKU code" }); return; }
    const sku_id = bySkuCode.get(sku_code);
    if (!sku_id) { errors.push({ row: i + 1, sku_code, reason: "No matching SKU in catalogue" }); return; }
    if (seenInFile.has(sku_code)) { errors.push({ row: i + 1, sku_code, reason: "Duplicate SKU code in file" }); return; }
    if (!barcode && !masterRaw) { errors.push({ row: i + 1, sku_code, reason: "No barcode code or master qty given" }); return; }
    seenInFile.add(sku_code);
    valid.push({
      sku_id, sku_code,
      ...(barcode ? { barcode_code: barcode } : {}),
      ...(masterRaw ? { master_qty: num(masterRaw) } : {}),
    });
  });

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, willUpdate: valid.length, errors, sample: valid.slice(0, 5) });
  }

  let updated = 0;
  for (const v of valid) {
    const { barcode_code, master_qty } = v;
    try {
      if (barcode_code != null && master_qty != null) {
        await sql`UPDATE skus SET barcode_code=${barcode_code}, master_qty=${master_qty} WHERE id=${v.sku_id}`;
      } else if (barcode_code != null) {
        await sql`UPDATE skus SET barcode_code=${barcode_code} WHERE id=${v.sku_id}`;
      } else if (master_qty != null) {
        await sql`UPDATE skus SET master_qty=${master_qty} WHERE id=${v.sku_id}`;
      }
      updated++;
    } catch (e) {
      errors.push({ row: 0, sku_code: v.sku_code, reason: (e as Error).message });
    }
  }

  if (updated > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: "sku.import_labels", entity: "sku",
      summary: `Backfilled barcode/master-qty on ${updated} SKU(s)${errors.length ? `, ${errors.length} skipped` : ""}`,
      meta: { updated, skipped: errors.length },
    });
  }
  return NextResponse.json({ ok: true, updated, skipped: errors.length, errors });
}
