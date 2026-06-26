import { NextResponse } from "next/server";
import { updateDeliveryOrderLine } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Editable physical attributes per packed line: Net Wt, Pack Wt, Bal RM —
// measured at packing time, not derivable from anything else in the system.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "dispatch")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit delivery orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const result = await updateDeliveryOrderLine(Number(id), {
    netWt: b.net_wt != null ? Number(b.net_wt) : undefined,
    packWt: b.pack_wt != null ? Number(b.pack_wt) : undefined,
    balRm: b.bal_rm != null ? Number(b.bal_rm) : undefined,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
