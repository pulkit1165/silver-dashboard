import { NextResponse } from "next/server";
import { getSalesOrders, createSalesOrder } from "@/lib/erp/queries";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ orders: await getSalesOrders() });
}

interface LineInput {
  sku_id: unknown;
  qty: unknown;
  price: unknown;
  mrp?: unknown;
  discount_pct?: unknown;
  rate_type?: unknown;
  foc_qty?: unknown;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create sales orders.` }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));
  const customerId = Number(b.customer_id);
  const lines: LineInput[] = Array.isArray(b.lines) ? b.lines : [];

  if (!customerId) return NextResponse.json({ ok: false, error: "Customer is required." }, { status: 400 });
  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: "At least one line item is required." }, { status: 400 });
  }
  for (const l of lines) {
    if (!Number(l.sku_id) || !Number(l.qty) || Number(l.qty) <= 0) {
      return NextResponse.json({ ok: false, error: "Each line needs a SKU and a positive quantity." }, { status: 400 });
    }
    if (Number(l.price) < 0) {
      return NextResponse.json({ ok: false, error: "Rate cannot be negative." }, { status: 400 });
    }
  }

  const result = await createSalesOrder({
    customerId,
    orderDate: typeof b.order_date === "string" && b.order_date ? b.order_date : new Date().toISOString().slice(0, 10),
    billType: typeof b.bill_type === "string" ? b.bill_type : undefined,
    discPct: b.disc_pct != null ? Number(b.disc_pct) : undefined,
    remarks: typeof b.remarks === "string" ? b.remarks : undefined,
    allowOverCreditLimit: b.allow_over_credit_limit === true,
    salesmanId: b.salesman_id != null ? Number(b.salesman_id) : undefined,
    source: typeof b.source === "string" ? b.source : undefined,
    lines: lines.map((l) => ({
      skuId: Number(l.sku_id),
      qty: Number(l.qty),
      price: Number(l.price) || 0,
      mrp: l.mrp != null ? Number(l.mrp) : undefined,
      discountPct: l.discount_pct != null ? Number(l.discount_pct) : undefined,
      rateType: typeof l.rate_type === "string" ? l.rate_type : undefined,
      focQty: l.foc_qty != null ? Number(l.foc_qty) : undefined,
    })),
  });
  if ("error" in result && result.error === "CREDIT_LIMIT_EXCEEDED") {
    return NextResponse.json({
      ok: false, error: result.message, creditLimitExceeded: true,
      creditLimit: result.creditLimit, outstanding: result.outstanding, orderTotal: result.orderTotal,
    }, { status: 422 });
  }
  return NextResponse.json({ ok: true, order: result }, { status: 201 });
}
