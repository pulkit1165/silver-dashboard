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
  if (!canWrite(user, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit SKUs.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const sql = getSql();

  // Optional product-name edit. The name lives ONLY on skus and is read live by
  // labels and sales orders (and snapshotted into new invoices at posting time),
  // so this one update propagates everywhere. Blank is ignored (never wipe a name).
  const newName = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const [before] = (await sql`SELECT sku_code, name FROM skus WHERE id=${Number(id)}`) as unknown as Array<{ sku_code: string; name: string }>;
  if (!before) return NextResponse.json({ ok: false, error: "SKU not found." }, { status: 404 });
  const renamed = newName && newName !== before.name;

  const [sku] = renamed
    ? await sql`
        UPDATE skus SET name=${newName}, master_qty=${Number(b.master_qty) || 0}, single_qty=${Number(b.single_qty) || 1},
          barcode_code=${b.barcode_code ? String(b.barcode_code) : ""}
        WHERE id=${Number(id)} RETURNING *`
    : await sql`
        UPDATE skus SET master_qty=${Number(b.master_qty) || 0}, single_qty=${Number(b.single_qty) || 1},
          barcode_code=${b.barcode_code ? String(b.barcode_code) : ""}
        WHERE id=${Number(id)} RETURNING *`;

  // The printed label prefers Label Master's Line 1/2/3 over skus.name. So a stale
  // custom label text would keep printing the OLD name after a rename — clear those
  // name lines (keeping units/lot/rack/name_class) so the label follows the new name.
  // Operators can re-enter a label-specific description in Barcode/Label Master.
  if (renamed) {
    try {
      await sql`UPDATE label_master SET line1='', line2='', line3='',
        updated_by=${user.name}, updated_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS')
        WHERE sku_code=${before.sku_code}`;
    } catch { /* label_master may not exist yet — nothing to clear */ }
  }

  await logActivity({
    actor: user.name, actorRole: user.role,
    action: renamed ? "sku.rename" : "sku.update", entity: "sku", entityId: (sku as { id: number }).id,
    summary: renamed
      ? `Renamed ${before.sku_code}: “${before.name}” → “${newName}”`
      : `Updated label info for ${before.sku_code}`,
  });
  return NextResponse.json({ ok: true, sku });
}
