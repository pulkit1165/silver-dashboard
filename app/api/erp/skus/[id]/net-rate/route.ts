import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { setItemNetRate, getNetRateHistory } from "@/lib/erp/pricing-masters";

export const dynamic = "force-dynamic";

// Item net-rate change history for one SKU (the recency ledger).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const history = await getNetRateHistory(Number(id));
  return NextResponse.json({ ok: true, history });
}

// Set a new global item net rate — appends history + mirrors skus.item_net_rate.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit net rates.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const res = await setItemNetRate({
    skuId: Number(id), netRate: Number(b.net_rate),
    effectiveAt: typeof b.effective_at === "string" ? b.effective_at : undefined,
    note: typeof b.note === "string" ? b.note : undefined,
    actor: user.name,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "sku.net_rate", entity: "sku", entityId: res.skuId,
    summary: `Set item net rate for ${res.sku_code} to ₹${res.effective}`,
  });
  return NextResponse.json({ ok: true, sku: { id: res.skuId, sku_code: res.sku_code, net_rate: res.effective } });
}
