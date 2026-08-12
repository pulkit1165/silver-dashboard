import { NextResponse } from "next/server";
import { getPackingSlip, deletePackingSlip } from "@/lib/erp/packing-slips";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const slip = await getPackingSlip(id);
  if (!slip) return NextResponse.json({ ok: false, error: "Slip not found" }, { status: 404 });
  return NextResponse.json({ ok: true, slip });
}

// Delete ONE saved slip (admin/dispatch/warehouse). Removes the archived document only;
// any real stock already dispatched via Delivery Orders is unaffected.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "dispatch")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot delete packing slips.` }, { status: 403 });
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return NextResponse.json({ ok: false, error: "Slip not found" }, { status: 404 });
  const removed = await deletePackingSlip(idNum);
  if (!removed) return NextResponse.json({ ok: false, error: "Slip not found" }, { status: 404 });
  await logActivity({ actor: user.name, actorRole: user.role, action: "packing_slip.delete", entity: "packing_slip", entityId: idNum, summary: `Deleted packing slip ${removed.slip_no}`, meta: { id: idNum, slipNo: removed.slip_no } }).catch(() => {});
  return NextResponse.json({ ok: true, slipNo: removed.slip_no });
}
