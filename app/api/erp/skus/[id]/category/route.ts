import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setSkuCategory } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Change a SKU's category (Item Master). Needs the "skus" permission.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit items.` }, { status: 403 });
  const { id } = await params;
  const skuId = Number(id);
  const b = (await req.json().catch(() => ({}))) as { category?: unknown };
  const res = await setSkuCategory(skuId, String(b.category ?? ""));
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role, action: "sku.category", entity: "sku", entityId: skuId,
    summary: `Set category of item #${skuId} to "${res.category}"`,
  });
  return NextResponse.json({ ok: true, category: res.category });
}
