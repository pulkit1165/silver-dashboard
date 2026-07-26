import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { createDecodedOrder, listDecodedOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, orders: await listDecodedOrders() });
}

// Salesman submits a manually-written order → saved as a decoded slip (staging).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot write orders.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const lines = Array.isArray(b.lines)
    ? b.lines.map((l: { sku_id: unknown; qty: unknown }) => ({ skuId: Number(l.sku_id), qty: Number(l.qty) }))
    : [];

  const result = await createDecodedOrder({
    customerId: Number(b.customer_id),
    salesmanName: typeof b.salesman_name === "string" ? b.salesman_name.trim() : "",
    orderDate: typeof b.order_date === "string" && b.order_date ? b.order_date : new Date().toISOString().slice(0, 10),
    requiredBy: typeof b.required_by === "string" ? b.required_by : "",
    remarks: typeof b.remarks === "string" ? b.remarks : "",
    createdById: user.id,
    lines,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });

  await logActivity({
    actor: user.name, actorRole: user.role, action: "sales.decode.submit",
    entity: "sales_order", entityId: result.id,
    summary: `Submitted decoded order ${result.so_no} (${b.salesman_name || user.name})`,
  });
  return NextResponse.json({ ok: true, id: result.id, so_no: result.so_no }, { status: 201 });
}
