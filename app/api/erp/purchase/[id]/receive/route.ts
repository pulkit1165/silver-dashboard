import { NextResponse } from "next/server";
import { receiveGoods } from "@/lib/erp/grn";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Records a goods receipt against this PO — adds stock, bumps po_lines.received_qty,
// recomputes PO status. Body: { warehouseId, binId?, lines: [{poLineId, skuId, qty}] }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "purchase")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot receive goods.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const result = await receiveGoods({
    poId: Number(id),
    warehouseId: Number(b.warehouseId),
    binId: b.binId != null ? Number(b.binId) : undefined,
    user: { id: user.id, name: user.name },
    lines: lines.map((l: { poLineId: number; skuId: number; qty: number }) => ({
      poLineId: Number(l.poLineId), skuId: Number(l.skuId), qty: Number(l.qty),
    })),
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, grnId: result.grnId });
}
