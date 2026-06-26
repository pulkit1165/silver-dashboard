import { NextResponse } from "next/server";
import { confirmSalesOrder } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Hands a draft order to the warehouse — only confirmed orders show up in
// the packing queue / dispatch screen.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot confirm sales orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await confirmSalesOrder(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "so.confirm", entity: "sales_order", entityId: Number(id),
    summary: `Confirmed sales order #${id} — sent to packing`,
  });
  return NextResponse.json({ ok: true });
}
