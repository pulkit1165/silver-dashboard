import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { discardDecodedOrder } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

// Discard an un-promoted decoded slip.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot discard orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await discardDecodedOrder(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  await logActivity({
    actor: user.name, actorRole: user.role, action: "sales.decode.discard",
    entity: "sales_order", entityId: id, summary: `Discarded decoded order #${id}`,
  });
  return NextResponse.json({ ok: true });
}
