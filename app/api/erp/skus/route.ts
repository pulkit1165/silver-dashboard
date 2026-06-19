import { NextResponse } from "next/server";
import { getSql, genToken } from "@/lib/erp/db";
import { getSkus } from "@/lib/erp/queries";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return NextResponse.json({ skus: await getSkus(q) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!canWrite(user.role, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create SKUs.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b.sku_code || !b.name) {
    return NextResponse.json({ ok: false, error: "SKU code and name are required." }, { status: 400 });
  }
  const sql = getSql();
  const [exists] = await sql`SELECT id FROM skus WHERE sku_code=${String(b.sku_code)}`;
  if (exists) return NextResponse.json({ ok: false, error: "SKU code already exists." }, { status: 409 });

  const [sku] = await sql`
    INSERT INTO skus (sku_code,name,category,brand,unit,price,min_stock,reorder_level,batch_tracked,serial_tracked,qr_token)
    VALUES (${String(b.sku_code)},${String(b.name)},${b.category ?? ""},${b.brand ?? ""},${b.unit ?? "PCS"},
            ${Number(b.price) || 0},${Number(b.min_stock) || 0},${Number(b.reorder_level) || 0},
            ${!!b.batch_tracked},${!!b.serial_tracked},${genToken()})
    RETURNING *`;
  return NextResponse.json({ ok: true, sku }, { status: 201 });
}
