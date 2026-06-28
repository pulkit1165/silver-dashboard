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
  const FIELDS = ["discount_pct", "discount_pct_18", "discount_pct_28"] as const;
  const field = FIELDS.find((f) => b[f] != null);
  if (!field || !Number.isFinite(Number(b[field])) || Number(b[field]) < 0) {
    return NextResponse.json({ ok: false, error: "A non-negative discount_pct, discount_pct_18, or discount_pct_28 is required." }, { status: 400 });
  }
  const value = Number(b[field]);
  const sql = getSql();
  const [customer] = await sql`UPDATE customers SET ${sql({ [field]: value })} WHERE id=${Number(id)} RETURNING id, code, name, discount_pct, discount_pct_18, discount_pct_28`;
  if (!customer) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "customer.rate", entity: "customer", entityId: (customer as { id: number }).id,
    summary: `Set ${field.replace(/_/g, " ")} for ${(customer as { name: string }).name} to ${value}%`,
  });
  return NextResponse.json({ ok: true, customer });
}
