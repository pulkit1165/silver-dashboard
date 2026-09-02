import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { updateDiscountClass } from "@/lib/erp/discount-classes";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "customers")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit discount classes.` }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { name?: string; wholeOrderPct?: number; active?: boolean } = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.whole_order_pct !== undefined) patch.wholeOrderPct = Number(body.whole_order_pct);
  if (body.active !== undefined) patch.active = Boolean(body.active);
  const result = await updateDiscountClass(Number(id), patch);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "discount_class.update", entity: "discount_class", entityId: Number(id),
    summary: `Updated discount class #${id}`, meta: patch,
  });
  return NextResponse.json({ ok: true });
}
