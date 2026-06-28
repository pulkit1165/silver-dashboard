import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Scoped to the barcode-label fields only — the rest of the SKU master is
// still create-once via /api/erp/skus or the bulk importer.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit SKUs.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const sql = getSql();
  const [sku] = await sql`
    UPDATE skus SET master_qty=${Number(b.master_qty) || 0}, single_qty=${Number(b.single_qty) || 1},
      barcode_code=${b.barcode_code ? String(b.barcode_code) : ""}
    WHERE id=${Number(id)} RETURNING *`;
  if (!sku) return NextResponse.json({ ok: false, error: "SKU not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "sku.update", entity: "sku", entityId: (sku as { id: number }).id,
    summary: `Updated label info for ${(sku as { sku_code: string }).sku_code}`,
  });
  return NextResponse.json({ ok: true, sku });
}
