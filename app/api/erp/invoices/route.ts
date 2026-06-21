import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listInvoices, createDraftFromSalesOrder } from "@/lib/erp/invoices";
import { getSalesOrderByNo } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, invoices: await listInvoices() });
}

// Create a DRAFT invoice from a sales order (by soId or soNo) — optionally from
// a packing slip. Pulls dispatched-but-uninvoiced lines; balance stays pending.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) {
    return NextResponse.json({ ok: false, error: `Your role (${user.role}) cannot create invoices.` }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  let soId = body.soId != null ? Number(body.soId) : null;
  if (!soId && body.soNo) {
    const so = await getSalesOrderByNo(String(body.soNo));
    soId = so?.id ?? null;
  }
  if (!soId) return NextResponse.json({ ok: false, error: "A sales order (soId or soNo) is required." }, { status: 400 });

  const result = await createDraftFromSalesOrder(soId, {
    createdBy: user.name,
    packingSlipId: body.packingSlipId != null ? Number(body.packingSlipId) : null,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, id: result.id });
}
