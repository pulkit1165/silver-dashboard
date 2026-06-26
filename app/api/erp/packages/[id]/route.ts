import { NextResponse } from "next/server";
import { getDeliveryOrder, updateDeliveryOrderHeader } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await getDeliveryOrder(Number(id));
  if (!doc) return NextResponse.json({ ok: false, error: "Delivery order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, doc });
}

// Editable header fields matching the legacy DO screen: TR Type, DO Type, PSlip No.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "dispatch")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit delivery orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const result = await updateDeliveryOrderHeader(Number(id), {
    trType: typeof b.tr_type === "string" ? b.tr_type : undefined,
    doType: typeof b.do_type === "string" ? b.do_type : undefined,
    slipNo: typeof b.slip_no === "string" ? b.slip_no : undefined,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
