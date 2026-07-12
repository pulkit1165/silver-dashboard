import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setMrp, getMrpHistory } from "@/lib/erp/mrp";

export const dynamic = "force-dynamic";

// MRP change history for one SKU (the recency ledger).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const history = await getMrpHistory(Number(id));
  return NextResponse.json({ ok: true, history });
}

// Set a new MRP for one SKU — appends history + syncs the live MRP everywhere.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit MRP.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const res = await setMrp({
    skuId: Number(id), mrp: Number(b.mrp),
    effectiveAt: typeof b.effective_at === "string" ? b.effective_at : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
    actor: user.name,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "sku.mrp", entity: "sku", entityId: res.skuId,
    summary: `Set MRP for ${res.sku_code} to ₹${res.effective}`,
  });
  return NextResponse.json({ ok: true, sku: { id: res.skuId, sku_code: res.sku_code, price: res.effective } });
}
