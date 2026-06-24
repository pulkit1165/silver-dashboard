import { NextResponse } from "next/server";
import { performScan } from "@/lib/erp/scan";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { SCAN_ACTIONS, type ScanAction } from "@/lib/erp/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body.action as ScanAction;
  const code = String(body.code ?? body.token ?? "");

  if (!code) return NextResponse.json({ ok: false, error: "No QR code provided." }, { status: 400 });
  if (!SCAN_ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: `Invalid action.` }, { status: 400 });
  }
  // a plain product lookup is allowed for any role; mutating actions need write rights
  if (action !== "lookup" && action !== "verify" && !canWrite(user.role, "scan")) {
    return NextResponse.json(
      { ok: false, error: `Your role (${user.role}) cannot perform "${action}".` },
      { status: 403 },
    );
  }

  const result = await performScan({
    user: { id: user.id, name: user.name },
    token: code,
    action,
    qty: body.qty != null ? Number(body.qty) : undefined,
    warehouseId: body.warehouseId != null ? Number(body.warehouseId) : undefined,
    binId: body.binId != null ? Number(body.binId) : undefined,
    toWarehouseId: body.toWarehouseId != null ? Number(body.toWarehouseId) : undefined,
    toBinId: body.toBinId != null ? Number(body.toBinId) : undefined,
    refDoc: body.refDoc ? String(body.refDoc) : undefined,
    packageNo: body.packageNo ? String(body.packageNo) : undefined,
    device: body.device ? String(body.device) : "web",
    batch: body.batch ? String(body.batch) : undefined,
  });
  if (result.ok && action !== "lookup" && action !== "verify") {
    await logActivity({
      actor: user.name, actorRole: user.role,
      action: `scan.${action}`, entity: "scan",
      summary: `${action.charAt(0).toUpperCase() + action.slice(1)} scan (${code})`,
      meta: { qty: body.qty ?? null, packageNo: body.packageNo ?? null, refDoc: body.refDoc ?? null },
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
