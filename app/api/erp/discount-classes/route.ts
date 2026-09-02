import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { listDiscountClasses, createDiscountClass } from "@/lib/erp/discount-classes";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const classes = await listDiscountClasses();
  return NextResponse.json({ ok: true, classes });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "customers")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create discount classes.` }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await createDiscountClass({
    code: String(body.code ?? ""), name: String(body.name ?? ""), wholeOrderPct: Number(body.whole_order_pct ?? 0),
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "discount_class.create", entity: "discount_class", entityId: result.id,
    summary: `Created discount class ${body.code} (${body.whole_order_pct}% off MRP)`,
  });
  return NextResponse.json({ ok: true, id: result.id });
}
