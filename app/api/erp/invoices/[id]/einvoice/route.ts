import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { saveEInvoiceDetails } from "@/lib/erp/invoices";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot record e-invoice details.` }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const result = await saveEInvoiceDetails(Number(id), {
    irn: String(b.irn ?? ""), ackNo: String(b.ack_no ?? ""), ackDate: String(b.ack_date ?? ""), qrPayload: String(b.qr_payload ?? ""),
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "einvoice.record", entity: "invoice", entityId: Number(id),
    summary: `Recorded e-invoice IRN for invoice #${id}`,
  });
  return NextResponse.json({ ok: true });
}
