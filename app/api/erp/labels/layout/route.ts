import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelLayouts, saveLabelLayout } from "@/lib/erp/labelLayout";

export const dynamic = "force-dynamic";

// All saved per-size label alignments (shared).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, layouts: await getLabelLayouts() });
}

// Save one size's alignment.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sizeId = String(b.sizeId || "").trim();
  if (!sizeId) return NextResponse.json({ ok: false, error: "sizeId required" }, { status: 400 });
  await saveLabelLayout(sizeId, {
    offsetX: Number(b.offsetX) || 0, offsetY: Number(b.offsetY) || 0, qrMM: Number(b.qrMM) || 0,
  }, user.name);
  return NextResponse.json({ ok: true });
}
