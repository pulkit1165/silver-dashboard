import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Fired right before window.print() — the actual print dialog runs entirely
// client-side, so this is the one server round-trip we get to audit who
// printed what.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const skuCodes: string[] = Array.isArray(body.skuCodes) ? body.skuCodes.map(String) : [];
  const labelCount = Number(body.labelCount) || skuCodes.length;
  if (skuCodes.length === 0) return NextResponse.json({ ok: false, error: "No SKUs given." }, { status: 400 });

  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "label.print", entity: "sku",
    summary: `Printed ${labelCount} barcode label${labelCount === 1 ? "" : "s"} for ${skuCodes.length} SKU(s)`,
    meta: { skuCodes, labelCount },
  });
  return NextResponse.json({ ok: true });
}
