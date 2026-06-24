import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { createPo } from "@/lib/erp/po-engine";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "purchase")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create POs.` }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const vendorId = Number(b.vendorId);
  if (!vendorId) return NextResponse.json({ ok: false, error: "Select a vendor." }, { status: 400 });

  const lines = Array.isArray(b.lines)
    ? b.lines.map((l: { skuId: unknown; qty: unknown; price: unknown }) => ({
        skuId: Number(l.skuId),
        qty: Number(l.qty),
        price: Number(l.price) || 0,
      }))
    : [];
  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: "No lines selected." }, { status: 400 });
  }

  try {
    const result = await createPo(vendorId, lines, user.id);
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: "po.create", entity: "purchase_order",
      entityId: (result as { id?: number; poNo?: string }).id ?? null,
      summary: `Created PO ${(result as { poNo?: string }).poNo ?? ""} for vendor #${vendorId} (${lines.length} line${lines.length > 1 ? "s" : ""})`.trim(),
      meta: { vendorId, lineCount: lines.length },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
