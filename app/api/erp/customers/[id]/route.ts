import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Customer master edit — GSTIN, state, place of supply, discount class and
// the standing discount % override. Gated on "customers" (admin/sales/accounts).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "customers")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit customers.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  const sql = getSql();
  const set: Record<string, unknown> = {};
  const summary: string[] = [];

  if (b.discount_pct !== undefined) {
    const pct = Number(b.discount_pct);
    if (!Number.isFinite(pct) || pct < 0) return NextResponse.json({ ok: false, error: "A non-negative discount_pct is required." }, { status: 400 });
    set.discount_pct = pct; summary.push(`discount ${pct}%`);
  }
  if (b.gst !== undefined) { set.gst = String(b.gst).toUpperCase().trim(); summary.push("GSTIN"); }
  if (b.state_code !== undefined) { set.state_code = String(b.state_code).trim(); summary.push("state"); }
  if (b.pos_state_code !== undefined) { set.pos_state_code = String(b.pos_state_code).trim(); summary.push("POS state"); }
  if (b.pincode !== undefined) { set.pincode = String(b.pincode).trim(); summary.push("pincode"); }
  if (b.discount_class_id !== undefined) {
    set.discount_class_id = b.discount_class_id === null ? null : Number(b.discount_class_id);
    summary.push("discount class");
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

  const [customer] = await sql`UPDATE customers SET ${sql(set)} WHERE id=${Number(id)} RETURNING *`;
  if (!customer) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "customer.update", entity: "customer", entityId: (customer as { id: number }).id,
    summary: `Updated ${(customer as { name: string }).name}: ${summary.join(", ")}`,
  });
  return NextResponse.json({ ok: true, customer });
}
