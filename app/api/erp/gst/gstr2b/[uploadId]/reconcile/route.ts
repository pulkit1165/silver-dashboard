import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { reconcileGstr2b } from "@/lib/erp/gstr2b";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ uploadId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "gst")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view GST reports.` }, { status: 403 });
  const { uploadId } = await params;
  const result = await reconcileGstr2b(Number(uploadId));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
