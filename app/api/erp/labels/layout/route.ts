import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelLayouts, saveLabelLayout, saveLabelDesign } from "@/lib/erp/labelLayout";
import { logActivity } from "@/lib/erp/activity";

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
  // Design-only toggle: change the template WITHOUT touching the saved alignment.
  if (b.designOnly) {
    await saveLabelDesign(sizeId, b.design === 2 || b.design === "2" ? 2 : 1, user.name);
    await logActivity({ actor: user.name, actorRole: user.role, action: "label.design.set", entity: "label_layout", entityId: sizeId, summary: `Set ${sizeId} to Label ${b.design === 2 || b.design === "2" ? 2 : 1}` }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  await saveLabelLayout(sizeId, {
    offsetX: Number(b.offsetX) || 0, offsetY: Number(b.offsetY) || 0, qrMM: Number(b.qrMM) || 0,
    elements: (b.elements && typeof b.elements === "object") ? b.elements : undefined,
    design: b.design === 2 || b.design === "2" ? 2 : b.design === 1 || b.design === "1" ? 1 : undefined,
  }, user.name);
  // Audit every save so an alignment change (or a later disappearance) is traceable.
  await logActivity({
    actor: user.name, actorRole: user.role, action: "label.layout.save", entity: "label_layout", entityId: sizeId,
    summary: `Saved label alignment for ${sizeId}`,
    meta: { offsetX: Number(b.offsetX) || 0, offsetY: Number(b.offsetY) || 0, elements: (b.elements && typeof b.elements === "object") ? b.elements : {} },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
