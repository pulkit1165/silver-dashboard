import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { computeEwbPayload, saveEwbNumber } from "@/lib/erp/ewb";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "eway_bills")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view e-way bills.` }, { status: 403 });
  const { id } = await params;
  const payload = await computeEwbPayload(Number(id));
  if (!payload) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  return NextResponse.json({ ok: true, payload });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "eway_bills")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot record e-way bills.` }, { status: 403 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const result = await saveEwbNumber(Number(id), String(b.ewb_no ?? ""), String(b.ewb_valid_until ?? ""));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "ewaybill.record", entity: "invoice", entityId: Number(id),
    summary: `Recorded e-way bill ${b.ewb_no} for invoice #${id}`,
  });
  return NextResponse.json({ ok: true });
}
