import { NextResponse } from "next/server";
import { jobStates } from "@/lib/erp/printnode";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Confirm whether print jobs actually reached the printer (in_progress/done).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ids: number[] = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isFinite(n));
  if (!ids.length) return NextResponse.json({ ok: true, states: {} });
  const states = await jobStates(ids);
  return NextResponse.json({ ok: true, states });
}
