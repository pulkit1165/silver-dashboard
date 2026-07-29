import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { syncMrpFromOracle } from "@/lib/erp/mrp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pull MRPs from Oracle (A_LABELPRINT) into the MRP master. Body:
// { only_missing?: boolean (default true), effective_at?: "YYYY-MM-DD" }.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "rates")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit MRP.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const res = await syncMrpFromOracle({
    actor: user.name,
    onlyMissing: b.only_missing === false ? false : true,
    effectiveAt: typeof b.effective_at === "string" ? b.effective_at : undefined,
  });
  if (res.updated > 0) {
    await logActivity({
      actor: user.name, actorRole: user.role, action: "sku.mrp.sync", entity: "sku",
      summary: `Pulled ${res.updated} MRP(s) from Oracle (${res.matched} matched)`,
      meta: res,
    });
  }
  return NextResponse.json({ ok: true, ...res });
}
