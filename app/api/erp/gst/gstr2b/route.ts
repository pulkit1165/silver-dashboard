import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listGstr2bUploads, uploadGstr2b } from "@/lib/erp/gstr2b";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "gst")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view GST reports.` }, { status: 403 });
  const uploads = await listGstr2bUploads();
  return NextResponse.json({ ok: true, uploads });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "gst")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot upload GSTR-2B.` }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const period = String(body.period ?? "").trim();
  if (!/^\d{6}$/.test(period)) return NextResponse.json({ ok: false, error: "period must be YYYYMM." }, { status: 400 });
  const result = await uploadGstr2b({
    period, fileName: String(body.fileName ?? ""), uploadedBy: user.name, uploadedByRole: user.role, raw: body.raw,
  });
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, id: result.id, count: result.count });
}
