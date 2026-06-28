import { NextResponse } from "next/server";
import { getSql } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Party-wise net rate master — updates the customer's standing discount %,
// applied to every item's MRP unless a discount-class/per-SKU override wins.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit rates.` }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  if (b.discount_pct == null || !Number.isFinite(Number(b.discount_pct)) || Number(b.discount_pct) < 0) {
    return NextResponse.json({ ok: false, error: "A non-negative discount_pct is required." }, { status: 400 });
  }
  const sql = getSql();
  const [customer] = await sql`UPDATE customers SET discount_pct=${Number(b.discount_pct)} WHERE id=${Number(id)} RETURNING id, code, name, discount_pct`;
  if (!customer) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "customer.rate", entity: "customer", entityId: (customer as { id: number }).id,
    summary: `Set standing discount for ${(customer as { name: string }).name} to ${(customer as { discount_pct: number }).discount_pct}%`,
  });
  return NextResponse.json({ ok: true, customer });
}
