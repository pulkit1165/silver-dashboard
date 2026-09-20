import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setSkuActive } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Toggle a SKU active/inactive (Item Master). Inactive items don't print or appear
// in browse/pick lists. Needs the "skus" permission.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit items.` }, { status: 403 });
  const { id } = await params;
  const skuId = Number(id);
  const b = (await req.json().catch(() => ({}))) as { active?: unknown };
  const active = b.active === true || b.active === "true";
  const res = await setSkuActive(skuId, active);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role, action: "sku.active", entity: "sku", entityId: skuId,
    summary: `${active ? "Activated" : "Deactivated"} item #${skuId}${active ? "" : " — will no longer print or appear in pick lists"}`,
  });
  return NextResponse.json({ ok: true, status: res.status });
}
