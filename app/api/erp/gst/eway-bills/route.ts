import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getEwbQueue } from "@/lib/erp/ewb";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "eway_bills")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view e-way bills.` }, { status: 403 });
  const queue = await getEwbQueue();
  return NextResponse.json({ ok: true, queue });
}
