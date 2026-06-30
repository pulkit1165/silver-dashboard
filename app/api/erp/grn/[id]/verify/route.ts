import { NextResponse } from "next/server";
import { verifyGoodsReceipt } from "@/lib/erp/grn";
import { getGoodsReceipt } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { getSql } from "@/lib/erp/db";

export const dynamic = "force-dynamic";

// Marks a received GRN as verified — the gate that makes it vendor-billable
// (see lib/erp/vendor-bills.ts). Notifies accounts, same pattern as the
// Delivery Order verify route.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "purchase")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot verify goods receipts.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await verifyGoodsReceipt(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });

  const doc = await getGoodsReceipt(Number(id));
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "grn.verify", entity: "goods_receipt", entityId: id,
    summary: doc ? `Verified ${doc.grn_no} on ${doc.po_no} — now vendor-billable` : `Verified GRN #${id} — now vendor-billable`,
  });
  if (doc) {
    await getSql()`INSERT INTO notifications (role, type, message) VALUES (
      'accounts', 'grn_verified',
      ${`${doc.po_no} (${doc.grn_no}, ${doc.vendor_name}) verified — ready to bill`}
    )`.catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
