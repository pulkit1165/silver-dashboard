import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { promoteDecodedOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Promote a decoded slip → an OPEN sales order (fresh SO-n) for review + punch.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot promote orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await promoteDecodedOrder(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });

  await logActivity({
    actor: user.name, actorRole: user.role, action: "sales.decode.promote",
    entity: "sales_order", entityId: result.soId,
    summary: `Promoted decoded order to open sales order ${result.soNo}`,
  });
  return NextResponse.json({ ok: true, soId: result.soId, soNo: result.soNo });
}
