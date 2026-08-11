import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelMasters, saveLabelMaster } from "@/lib/erp/labelMaster";

export const dynamic = "force-dynamic";

// All label-master rows (structured label text per SKU).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, master: await getLabelMasters() });
}

// Save one SKU's label structure (blank all → clears it).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const skuCode = String(b.skuCode || "").trim();
  if (!skuCode) return NextResponse.json({ ok: false, error: "skuCode required" }, { status: 400 });
  await saveLabelMaster(skuCode, {
    line1: b.line1, line2: b.line2, line3: b.line3, units: b.units, lot: b.lot, rack: b.rack,
    unitQty: Number(b.unitQty) || 0,
  }, user.name);
  return NextResponse.json({ ok: true });
}
