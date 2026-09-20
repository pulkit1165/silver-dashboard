import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getDesign, listDesigns, saveDraft, approveDesign, revertDraft } from "@/lib/erp/labelDesign";
import { isSizeLocked } from "@/lib/erp/labelLayout";
import { logActivity } from "@/lib/erp/activity";
import type { LabelDoc } from "@/lib/erp/labelDoc";

export const dynamic = "force-dynamic";

// GET ?sizeId=... → that size's design (draft + approved + status + locked)
// GET (no sizeId)  → all designs (for the picker)
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const sizeId = new URL(req.url).searchParams.get("sizeId");
  if (sizeId) {
    const [design, locked] = await Promise.all([getDesign(sizeId), isSizeLocked(sizeId)]);
    return NextResponse.json({ ok: true, design, locked });
  }
  return NextResponse.json({ ok: true, designs: await listDesigns() });
}

// POST { action: 'save'|'approve'|'revert', sizeId, doc? }
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "labels")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit labels.` }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const sizeId = String(b.sizeId || "").trim();
  const action = String(b.action || "save");
  if (!sizeId) return NextResponse.json({ ok: false, error: "sizeId required" }, { status: 400 });

  if (action === "save") {
    const doc = b.doc as LabelDoc;
    if (!doc || !Array.isArray(doc.elements) || !(doc.w > 0) || !(doc.h > 0))
      return NextResponse.json({ ok: false, error: "Invalid design document." }, { status: 400 });
    if (doc.elements.length > 200) return NextResponse.json({ ok: false, error: "Too many elements." }, { status: 400 });
    await saveDraft(sizeId, doc, user.name);
    logActivity({ actor: user.name, actorRole: user.role, action: "label.design.save", entity: "label_design", entityId: sizeId, summary: `Saved draft design · ${sizeId} · ${doc.elements.length} elements` });
    return NextResponse.json({ ok: true });
  }

  if (action === "approve") {
    // A locked/approved size keeps printing its current design until it is unlocked.
    if (await isSizeLocked(sizeId))
      return NextResponse.json({ ok: false, error: "This size is LOCKED — unlock it first, then approve the new design. The current design keeps printing until then." }, { status: 409 });
    const r = await approveDesign(sizeId, user.name);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    logActivity({ actor: user.name, actorRole: user.role, action: "label.design.approve", entity: "label_design", entityId: sizeId, summary: `APPROVED new design → now printing · ${sizeId}` });
    return NextResponse.json({ ok: true });
  }

  if (action === "revert") {
    await revertDraft(sizeId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
