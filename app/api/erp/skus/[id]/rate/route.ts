import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Item-wise net rate master — updates the SKU's standard selling price
// (independent of MRP and of any per-customer discount).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  if (b.selling_price == null || !Number.isFinite(Number(b.selling_price)) || Number(b.selling_price) < 0) {
    return NextResponse.json({ ok: false, error: "A non-negative selling_price is required." }, { status: 400 });
  }
  const sql = getSql();
  const [sku] = await sql`UPDATE skus SET selling_price=${Number(b.selling_price)} WHERE id=${Number(id)} RETURNING id, sku_code, selling_price`;
  if (!sku) return NextResponse.json({ ok: false, error: "SKU not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "sku.rate", entity: "sku", entityId: (sku as { id: number }).id,
    summary: `Set net rate for ${(sku as { sku_code: string }).sku_code} to ₹${(sku as { selling_price: number }).selling_price}`,
  });
  return NextResponse.json({ ok: true, sku });
}
