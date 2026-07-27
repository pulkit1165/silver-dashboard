import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { createDecodedOrder, listDecodedOrders, learnSkuAliases } from "@/lib/erp/queries";
import { normalise } from "@/lib/erp/sales-decode";

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
  type RawLine = { sku_id: unknown; qty: unknown; raw_text?: unknown; price?: unknown; mrp?: unknown; discount_pct?: unknown; rate_type?: unknown; foc_qty?: unknown };
  const rawLines: RawLine[] = Array.isArray(b.lines) ? b.lines : [];
  const lines = rawLines.map((l) => ({
    skuId: Number(l.sku_id), qty: Number(l.qty),
    price: l.price != null ? Number(l.price) : undefined,
    mrp: l.mrp != null ? Number(l.mrp) : undefined,
    discountPct: l.discount_pct != null ? Number(l.discount_pct) : undefined,
    rateType: typeof l.rate_type === "string" ? l.rate_type : undefined,
    focQty: l.foc_qty != null ? Number(l.foc_qty) : undefined,
  }));

  const result = await createDecodedOrder({
    customerId: Number(b.customer_id),
    salesmanName: typeof b.salesman_name === "string" ? b.salesman_name.trim() : "",
    orderDate: typeof b.order_date === "string" && b.order_date ? b.order_date : new Date().toISOString().slice(0, 10),
    requiredBy: typeof b.required_by === "string" ? b.required_by : "",
    remarks: typeof b.remarks === "string" ? b.remarks : "",
    createdById: user.id,
    salesmanId: b.salesman_id != null ? Number(b.salesman_id) : undefined,
    source: typeof b.source === "string" ? b.source : "decode-manual",
    lines,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });

  // Learn: teach the decoder every (raw text → confirmed SKU) pairing so the
  // same shorthand matches instantly next time. Only from decode paths (the
  // manual writer picks SKUs directly, so its lines carry no raw_text).
  const learn = rawLines
    .filter((l) => typeof l.raw_text === "string" && (l.raw_text as string).trim() && Number(l.sku_id))
    .map((l) => ({ aliasNorm: normalise(l.raw_text as string), skuId: Number(l.sku_id) }));
  if (learn.length) { try { await learnSkuAliases(learn, user.name); } catch { /* non-fatal */ } }

  await logActivity({
    actor: user.name, actorRole: user.role, action: "sales.decode.submit",
    entity: "sales_order", entityId: result.id,
    summary: `Submitted decoded order ${result.so_no} (${b.salesman_name || user.name}) — learned ${learn.length} alias(es)`,
  });
  return NextResponse.json({ ok: true, id: result.id, so_no: result.so_no }, { status: 201 });
}
