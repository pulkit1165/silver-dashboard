import { NextResponse } from "next/server";
import { getSql, genToken } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { norm, pick, num } from "@/lib/erp/skuImport";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot import SKUs.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = Boolean(body.dryRun);
  if (rows.length === 0) return NextResponse.json({ ok: false, error: "No rows provided." }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ ok: false, error: "Max 5000 rows per import." }, { status: 400 });

  const sql = getSql();
  const [wh] = await sql`SELECT id FROM warehouses ORDER BY id LIMIT 1`;
  const warehouseId = body.warehouseId ? Number(body.warehouseId) : (wh as { id: number })?.id;

  // existing codes for duplicate detection
  const existingRows = (await sql`SELECT sku_code FROM skus`) as unknown as { sku_code: string }[];
  const existing = new Set(existingRows.map((r) => r.sku_code.toUpperCase()));
  const seenInFile = new Set<string>();

  const errors: { row: number; sku_code: string; reason: string }[] = [];
  const valid: Record<string, string>[] = [];

  rows.forEach((raw, i) => {
    const rn: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) rn[norm(k)] = v == null ? "" : String(v).trim();
    const sku_code = pick(rn, "sku_code").trim().toUpperCase();
    const name = pick(rn, "name").trim();
    if (!sku_code && !name) return; // blank line — skip silently
    if (!sku_code) { errors.push({ row: i + 1, sku_code: "", reason: "Missing SKU code" }); return; }
    if (!name) { errors.push({ row: i + 1, sku_code, reason: "Missing item name" }); return; }
    if (existing.has(sku_code)) { errors.push({ row: i + 1, sku_code, reason: "Already exists in catalogue" }); return; }
    if (seenInFile.has(sku_code)) { errors.push({ row: i + 1, sku_code, reason: "Duplicate SKU code in file" }); return; }
    seenInFile.add(sku_code);
    valid.push({
      sku_code, name,
      category: pick(rn, "category") || name.split(/\s+/)[0].toUpperCase(),
      brand: pick(rn, "brand"),
      unit: pick(rn, "unit") || "PCS",
      hsn: pick(rn, "hsn"),
      purchase_price: String(num(pick(rn, "purchase_price"))),
      selling_price: String(num(pick(rn, "selling_price"))),
      opening_stock: String(num(pick(rn, "opening_stock"))),
      reorder_level: String(num(pick(rn, "reorder_level"))),
      master_qty: String(num(pick(rn, "master_qty"))),
      single_qty: String(num(pick(rn, "single_qty")) || 1),
      barcode_code: pick(rn, "barcode_code"),
    });
  });

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, willImport: valid.length, errors, sample: valid.slice(0, 5) });
  }

  let inserted = 0;
  const created: { sku_code: string; token: string }[] = [];
  for (const v of valid) {
    try {
      const token = genToken();
      const sell = num(v.selling_price);
      const [sku] = await sql`
        INSERT INTO skus (sku_code,name,category,brand,unit,price,purchase_price,selling_price,hsn,reorder_level,master_qty,single_qty,barcode_code,qr_token)
        VALUES (${v.sku_code},${v.name},${v.category},${v.brand},${v.unit},${sell},${num(v.purchase_price)},${sell},${v.hsn},${num(v.reorder_level)},${num(v.master_qty)},${num(v.single_qty) || 1},${v.barcode_code},${token})
        RETURNING id`;
      const skuId = (sku as { id: number }).id;
      await sql`INSERT INTO qr_codes (sku_id,sku_code,token,status,created_by) VALUES (${skuId},${v.sku_code},${token},'active',${user.name})`;
      const opening = num(v.opening_stock);
      if (opening > 0 && warehouseId) {
        await sql`INSERT INTO inventory (sku_id,warehouse_id,bin_id,batch,qty) VALUES (${skuId},${warehouseId},0,'',${opening})
                  ON CONFLICT (sku_id,warehouse_id,bin_id,batch) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty`;
        await sql`INSERT INTO stock_moves (sku_id,warehouse_id,bin_id,type,qty,ref_doc,note,user_id) VALUES (${skuId},${warehouseId},0,'opening',${opening},'IMPORT','Opening stock (import)',${user.id})`;
      }
      inserted++;
      created.push({ sku_code: v.sku_code, token });
    } catch (e) {
      errors.push({ row: 0, sku_code: v.sku_code, reason: (e as Error).message });
    }
  }

  if (inserted > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: "sku.import", entity: "sku",
      summary: `Imported ${inserted} SKU(s)${errors.length ? `, ${errors.length} skipped` : ""}`,
      meta: { inserted, skipped: errors.length },
    });
  }
  return NextResponse.json({ ok: true, inserted, skipped: errors.length, errors, created });
}
