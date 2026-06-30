import { NextResponse } from "next/server";
import { cancelSoLineQty } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Formal shortfall write-off on one order line — legacy Cancellation slip
// (DTC107) equivalent. Removes the qty from the pending-to-pack queue for
// good instead of leaving it stuck as a phantom balance forever.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot cancel order lines.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const qty = Number(b.qty);
  const reason = typeof b.reason === "string" ? b.reason : "";
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ ok: false, error: "A positive qty is required." }, { status: 400 });
  }
  const result = await cancelSoLineQty({ soLineId: Number(id), qty, reason, cancelledBy: user.name });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
