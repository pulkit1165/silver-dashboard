import { NextResponse } from "next/server";
import { getSalesOrder } from "@/lib/erp/queries";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const so = await getSalesOrder(Number(id));
  if (!so) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, order: so });
}

// Update logistics/notes on an order: transporter, tracking id, remarks (notes).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  if (typeof b.transporter === "string") patch.transporter = b.transporter.trim();
  if (typeof b.tracking_id === "string") patch.tracking_id = b.tracking_id.trim();
  if (typeof b.remarks === "string") patch.remarks = b.remarks;
  const cols = Object.keys(patch);
  if (cols.length === 0) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const sql = getSql();
  const [row] = await sql`UPDATE sales_orders SET ${sql(patch, ...cols)} WHERE id=${Number(id)} RETURNING id, so_no`;
  if (!row) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role, action: "sales_order.update", entity: "sales_order", entityId: Number(id),
    summary: `Updated ${(row as { so_no: string }).so_no}: ${cols.join(", ")}`,
    meta: patch,
  });
  return NextResponse.json({ ok: true });
}
