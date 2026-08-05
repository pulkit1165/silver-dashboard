import { NextResponse } from "next/server";
import { listBridgePrinters, setPrinterConfig } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { LABEL_SIZES } from "@/lib/erp/labelSizes";

export const dynamic = "force-dynamic";

// App → list bridge printers (agents that have heartbeated), for the dropdown/manager.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, printers: await listBridgePrinters(), sizes: LABEL_SIZES });
}

// Operator sets a printer's code (rename), label size, and lock.
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot configure printers.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const id = typeof b.id === "string" ? b.id : "";
  if (!id) return NextResponse.json({ ok: false, error: "printer id required" }, { status: 400 });
  if (typeof b.label_size === "string" && b.label_size && !LABEL_SIZES.some((s) => s.id === b.label_size)) {
    return NextResponse.json({ ok: false, error: "Unknown label size." }, { status: 400 });
  }
  const res = await setPrinterConfig(id, {
    code: typeof b.code === "string" ? b.code : undefined,
    labelSize: typeof b.label_size === "string" ? b.label_size : undefined,
    locked: typeof b.locked === "boolean" ? b.locked : undefined,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  await logActivity({
    actor: user.name, actorRole: user.role, action: "printer.config", entity: "printer", entityId: id,
    summary: `Configured printer ${b.code || id}${b.label_size ? ` · size ${b.label_size}` : ""}${b.locked != null ? ` · ${b.locked ? "locked" : "unlocked"}` : ""}`,
  });
  return NextResponse.json({ ok: true });
}
