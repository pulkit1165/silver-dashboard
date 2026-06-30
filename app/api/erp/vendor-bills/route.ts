import { NextResponse } from "next/server";
import { createVendorBill, logVendorBillActivity } from "@/lib/erp/vendor-bills";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Creates a draft vendor bill from a PO's verified-but-unbilled receipt qty.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "purchase")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create vendor bills.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const poId = Number(b.poId);
  if (!poId) return NextResponse.json({ ok: false, error: "poId is required." }, { status: 400 });
  const result = await createVendorBill(poId, {
    billNo: typeof b.billNo === "string" ? b.billNo : undefined,
    billDate: typeof b.billDate === "string" ? b.billDate : undefined,
    createdBy: user.name,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  await logVendorBillActivity(user.name, user.role, result.id, poId).catch(() => {});
  return NextResponse.json({ ok: true, id: result.id });
}
