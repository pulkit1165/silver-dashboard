import { NextResponse } from "next/server";
import { verifyDeliveryOrder, getDeliveryOrder } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { getSql } from "@/lib/erp/db";

export const dynamic = "force-dynamic";

// Marks a packed Delivery Order as verified — the gate that makes its qty
// billable (see lib/erp/invoices.ts gatherDraft / getPendingToBill). Notifies
// accounts so billing doesn't have to keep polling the Deliveries list.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "dispatch")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot verify delivery orders.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await verifyDeliveryOrder(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });

  const doc = await getDeliveryOrder(Number(id));
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "do.verify", entity: "package", entityId: id,
    summary: doc ? `Verified Case ${doc.package_no} on ${doc.so_no} — now billable` : `Verified Delivery Order #${id} — now billable`,
  });
  if (doc) {
    await getSql()`INSERT INTO notifications (role, type, message) VALUES (
      'accounts', 'do_verified',
      ${`${doc.so_no} (Case ${doc.package_no}, ${doc.customer_name}) verified — ready to bill`}
    )`.catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
